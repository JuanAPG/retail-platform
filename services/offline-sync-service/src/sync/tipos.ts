/**
 * Tipos del contrato `docs/contratos/offline-sync-service.md` (§4).
 * El ORDEN de los campos de cada objeto de respuesta es el del XSD
 * (`xs:sequence`): el XmlInterceptor los emite en ese orden.
 */

export const VERSION_CONTRATO = '1.0';

export const TIPOS_CAPTURA = ['disponibilidad', 'precio_observado'] as const;
export type TipoCaptura = (typeof TIPOS_CAPTURA)[number];

export const CLIENTES = ['movil', 'escritorio'] as const;
export type Cliente = (typeof CLIENTES)[number];

export const ESTADOS_CAPTURA = ['aceptada', 'duplicada', 'conflicto', 'rechazada'] as const;
export type EstadoCaptura = (typeof ESTADOS_CAPTURA)[number];

/** Resultado que una captura puede tener la primera vez (nunca `duplicada`). */
export type EstadoFinal = 'aceptada' | 'conflicto' | 'rechazada';

/** Códigos del catálogo estándar (`services/snippets/error-codes.md`). */
export type CodigoMotivo =
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL';

export interface Motivo {
  code: CodigoMotivo;
  message: string;
}

export type ServicioDestino = 'availability-service' | 'pricing-service';

export interface Destino {
  service: ServicioDestino;
  id: string;
}

/** Contenido de una captura: qué campo exige cada `type` lo decide `validarCaptura`. */
export interface ContenidoCaptura {
  stock?: number;
  price?: number;
  lat?: number;
  lng?: number;
}

/** Una captura tal como llega (JSON o XML ya convertido). */
export interface CapturaEntrada {
  captureId: string;
  type: TipoCaptura;
  contractVersion: string;
  capturedAt: string;
  storeId?: string;
  presentationId?: string;
  content: ContenidoCaptura;
}

export interface LoteEntrada {
  batchId: string;
  deviceId: string;
  contractVersion: string;
  client: Cliente;
  sentAt?: string;
  captures: CapturaEntrada[];
}

/** Un elemento de `results` del acuse. */
export interface ResultadoCaptura {
  captureId: string;
  type: TipoCaptura;
  status: EstadoCaptura;
  originalStatus?: EstadoFinal;
  capturedAt: string;
  target: Destino | null;
  serverCapturedAt?: string;
  reason: Motivo | null;
  retryable: boolean;
}

export interface Resumen {
  total: number;
  aceptadas: number;
  duplicadas: number;
  conflictos: number;
  rechazadas: number;
}

/** Raíz `acuseLote` del XSD. */
export interface Acuse {
  batchId: string;
  deviceId: string;
  userId: string;
  client: Cliente;
  contractVersion: string;
  receivedAt: string;
  resend: boolean;
  correlationId: string;
  summary: Resumen;
  results: ResultadoCaptura[];
}

/** Estado de entrega de la auditoría o el aviso (evidencia de §8). */
export type EstadoEntrega = 'pendiente' | 'enviado' | 'fallido' | 'no_aplica';

export function resumir(resultados: ResultadoCaptura[]): Resumen {
  const cuenta = (estado: EstadoCaptura) => resultados.filter((r) => r.status === estado).length;
  return {
    total: resultados.length,
    aceptadas: cuenta('aceptada'),
    duplicadas: cuenta('duplicada'),
    conflictos: cuenta('conflicto'),
    rechazadas: cuenta('rechazada'),
  };
}

/** Arma un resultado con los campos en el orden del XSD. */
export function resultado(datos: {
  captureId: string;
  type: TipoCaptura;
  status: EstadoCaptura;
  originalStatus?: EstadoFinal;
  capturedAt: string;
  target?: Destino | null;
  serverCapturedAt?: string | null;
  reason?: Motivo | null;
  retryable?: boolean;
}): ResultadoCaptura {
  return {
    captureId: datos.captureId,
    type: datos.type,
    status: datos.status,
    ...(datos.originalStatus ? { originalStatus: datos.originalStatus } : {}),
    capturedAt: datos.capturedAt,
    target: datos.target ?? null,
    ...(datos.serverCapturedAt ? { serverCapturedAt: datos.serverCapturedAt } : {}),
    reason: datos.reason ?? null,
    retryable: datos.retryable ?? false,
  };
}
