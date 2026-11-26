import {
  Cliente,
  ContenidoCaptura,
  Destino,
  EstadoEntrega,
  EstadoFinal,
  Motivo,
  ResultadoCaptura,
  Resumen,
  TipoCaptura,
} from '../tipos';

/**
 * Puertos de almacenamiento (D-47). Producción: MongoDB (`lotes_sync`,
 * `capturas_sync`) y Redis (candado, caché de idempotencia, último estado).
 * Las unitarias usan los adaptadores en memoria de `memoria.ts`.
 *
 * Un almacén que no responde lanza `ServiceUnavailableException` (503, D-25).
 */

export const REPOSITORIO_SYNC = Symbol('REPOSITORIO_SYNC');
export const ALMACEN_RAPIDO = Symbol('ALMACEN_RAPIDO');

/** `procesando` = reservada antes de ir al destino (escritura adelantada). */
export type EstadoGuardado = 'procesando' | EstadoFinal;

export interface CapturaGuardada {
  captureId: string;
  batchId: string;
  userId: string;
  type: TipoCaptura;
  storeId: string | null;
  presentationId: string | null;
  capturedAt: Date;
  contractVersion: string;
  content: ContenidoCaptura;
  hash: string;
  status: EstadoGuardado;
  retryable: boolean;
  target: Destino | null;
  serverCapturedAt: Date | null;
  reason: Motivo | null;
  receivedAt: Date;
  updatedAt: Date;
}

export interface Entrega {
  audit: EstadoEntrega;
  auditError: string | null;
  notification: EstadoEntrega;
  notificationError: string | null;
}

export interface LoteGuardado {
  batchId: string;
  userId: string;
  deviceId: string;
  client: Cliente;
  contractVersion: string;
  sentAt: Date | null;
  hash: string;
  correlationId: string;
  receivedAt: Date;
  estado: 'procesando' | 'terminado';
  captureIds: string[];
  /** Acuse tal como se emitió para este lote (`null` hasta terminar la primera vez). */
  resultados: ResultadoCaptura[] | null;
  resumen: Resumen | null;
  /** Estados presentes en `resultados` (filtro `status` del listado). */
  estados: string[];
  delivery: Entrega;
  updatedAt: Date;
}

export interface FiltroLotes {
  userId?: string;
  deviceId?: string;
  status?: string;
  desde?: Date;
  hasta?: Date;
}

export interface RepositorioSync {
  buscarLote(batchId: string): Promise<LoteGuardado | null>;
  /** `false` si ya existía (llave `_id = batchId`). */
  crearLote(lote: LoteGuardado): Promise<boolean>;
  guardarResultados(
    batchId: string,
    resultados: ResultadoCaptura[],
    resumen: Resumen,
    estados: string[],
  ): Promise<void>;
  marcarEntrega(batchId: string, canal: 'audit' | 'notification', estado: EstadoEntrega, error: string | null): Promise<void>;
  buscarCapturas(ids: string[]): Promise<Map<string, CapturaGuardada>>;
  /** Reserva el `captureId` (`_id` único). `false` si otro ya lo tenía. */
  reservarCaptura(captura: CapturaGuardada): Promise<boolean>;
  guardarCaptura(captura: CapturaGuardada): Promise<void>;
  /** `capturedAt` de la última captura ACEPTADA de ese tipo, tienda y presentación. */
  ultimaAceptada(type: TipoCaptura, storeId: string, presentationId: string): Promise<Date | null>;
  listarLotes(filtro: FiltroLotes, skip: number, limit: number): Promise<{ filas: LoteGuardado[]; total: number }>;
}

/** Lo que se guarda en Redis por `captureId`: solo resultados FINALES. */
export interface CapturaEnCache {
  captureId: string;
  batchId: string;
  userId: string;
  type: TipoCaptura;
  hash: string;
  status: EstadoFinal;
  capturedAt: string;
  target: Destino | null;
  serverCapturedAt: string | null;
  reason: Motivo | null;
}

export interface AlmacenRapido {
  /** `SET NX PX`: `false` si otro proceso ya tiene el lote. */
  tomarCandado(batchId: string, dueno: string, ms: number): Promise<boolean>;
  /** Solo lo suelta quien lo tomó. */
  soltarCandado(batchId: string, dueno: string): Promise<void>;
  leerCapturas(ids: string[]): Promise<Map<string, CapturaEnCache>>;
  guardarCaptura(captura: CapturaEnCache): Promise<void>;
  leerUltimo(llave: string): Promise<string | null>;
  /** Guarda el instante solo si es MAYOR al que ya había (compare-and-set). */
  subirUltimo(llave: string, instanteIso: string): Promise<void>;
}
