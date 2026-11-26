import { createHash } from 'crypto';
import { ROL } from '../common/roles';
import { CapturaEntrada, LoteEntrada, Motivo, TipoCaptura, VERSION_CONTRATO } from './tipos';

/**
 * Reglas puras del contrato (§2 y §4.4–§4.7). Sin E/S: se prueban solas.
 */

/** Relojes de teléfono adelantados: más de esto en el futuro es un error (igual que pricing y availability). */
export const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

/** Máximo de capturas por lote (contrato §4.3): más → 413. */
export const MAX_CAPTURAS = 500;

/**
 * Quién puede ENVIAR un lote (§2). El Planeador queda fuera: no puede dar de
 * alta ningún tipo de captura en ningún destino (contradicción reportada).
 */
export const ROLES_QUE_ENVIAN = [ROL.INVESTIGADOR, ROL.ANALISTA, ROL.RESPONSABLE_PRECIOS] as const;

/** Quién lee CUALQUIER lote (§2); los que envían leen solo los suyos. */
export const ROLES_QUE_LEEN_TODO = [ROL.ADMINISTRADOR, ROL.AUDITOR] as const;

/**
 * Permiso por tipo de captura (§2): el rol que el servicio destino acepta para
 * dar de alta ese tipo (contratos de availability y pricing).
 */
export const ROLES_POR_TIPO: Record<TipoCaptura, readonly string[]> = {
  disponibilidad: [ROL.INVESTIGADOR, ROL.ANALISTA],
  precio_observado: [ROL.INVESTIGADOR, ROL.ANALISTA, ROL.RESPONSABLE_PRECIOS],
};

export function puedeEnviarTipo(rol: string, tipo: TipoCaptura): boolean {
  return ROLES_POR_TIPO[tipo].includes(rol);
}

/** Instante ISO 8601 con zona horaria OBLIGATORIA, con segundos (igual que `xs:dateTime` + patrón del XSD). */
export const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function aUtc(instante: string): string {
  return new Date(instante).toISOString();
}

function conDosDecimales(valor: number): boolean {
  return Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-9;
}

/**
 * Reglas por captura (§4.4). Devuelve el motivo del rechazo o `null`. Un
 * error aquí deja SOLO esa captura `rechazada`; el lote sigue.
 */
export function validarCaptura(c: CapturaEntrada, ahora: Date): Motivo | null {
  const invalida = (message: string): Motivo => ({ code: 'VALIDATION_ERROR', message });

  if (c.contractVersion !== VERSION_CONTRATO) {
    return invalida(`contractVersion ${c.contractVersion} no está soportada; la versión vigente es ${VERSION_CONTRATO}.`);
  }
  if (!c.storeId) return invalida('storeId es obligatorio para este tipo de captura.');
  if (!c.presentationId) return invalida('presentationId es obligatorio para este tipo de captura.');

  const { stock, price, lat, lng } = c.content;
  if (c.type === 'disponibilidad') {
    if (price !== undefined || lat !== undefined || lng !== undefined) {
      return invalida('Una captura de disponibilidad solo lleva content.stock.');
    }
    if (stock === undefined) return invalida('content.stock es obligatorio en disponibilidad.');
    if (stock < 0) return invalida('content.stock no puede ser negativo.');
    if (!conDosDecimales(stock)) return invalida('content.stock admite hasta 2 decimales.');
  } else {
    if (stock !== undefined) return invalida('Un precio observado no lleva content.stock.');
    if (price === undefined) return invalida('content.price es obligatorio en precio_observado.');
    if (price <= 0) return invalida('content.price debe ser mayor a 0.');
    if (!conDosDecimales(price)) return invalida('content.price admite hasta 2 decimales.');
    if ((lat === undefined) !== (lng === undefined)) {
      return invalida('content.lat y content.lng van juntas o ninguna.');
    }
    if (lat !== undefined && (lat < -90 || lat > 90)) return invalida('content.lat debe estar entre -90 y 90.');
    if (lng !== undefined && (lng < -180 || lng > 180)) return invalida('content.lng debe estar entre -180 y 180.');
  }

  if (new Date(c.capturedAt).getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MS) {
    return invalida('capturedAt no puede estar más de 5 minutos en el futuro.');
  }
  return null;
}

/** Llave del "mismo dato" de D-42: tipo + tienda + presentación. */
export function llaveDato(c: Pick<CapturaEntrada, 'type' | 'storeId' | 'presentationId'>): string {
  return `${c.type}:${c.storeId}:${c.presentationId}`;
}

/**
 * Huella de una captura. Normaliza lo que puede variar entre JSON y XML o
 * entre reintentos sin cambiar el dato (zona horaria del instante, número
 * escrito como texto), así el mismo dato da la misma huella.
 */
export function huellaCaptura(c: CapturaEntrada): string {
  const datos = [
    c.captureId,
    c.type,
    c.contractVersion,
    aUtc(c.capturedAt),
    c.storeId ?? null,
    c.presentationId ?? null,
    c.content.stock ?? null,
    c.content.price ?? null,
    c.content.lat ?? null,
    c.content.lng ?? null,
  ];
  return createHash('sha256').update(JSON.stringify(datos)).digest('hex');
}

/**
 * Huella del lote (§4.8): dispositivo, versión y capturas EN ORDEN. `sentAt`
 * y `client` no entran: un reintento puede traer otro `sentAt`.
 */
export function huellaLote(lote: LoteEntrada): string {
  const datos = [lote.deviceId, lote.contractVersion, lote.captures.map(huellaCaptura)];
  return createHash('sha256').update(JSON.stringify(datos)).digest('hex');
}

/** `captureId` repetidos dentro del mismo lote (→ 400 del lote, §4.3). */
export function idsRepetidos(capturas: Array<{ captureId: string }>): string[] {
  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const { captureId } of capturas) {
    const id = captureId.toLowerCase();
    if (vistos.has(id)) repetidos.add(captureId);
    vistos.add(id);
  }
  return [...repetidos];
}

export interface Perdedora {
  ganadora: CapturaEntrada;
}

/**
 * Conflicto dentro del mismo lote (§4.7, paso 1): por cada tipo + tienda +
 * presentación solo sigue la de `capturedAt` mayor; empate exacto → gana la
 * que aparece primero. Devuelve, por `captureId` perdedor, quién le ganó.
 */
export function perdedorasDentroDelLote(candidatas: CapturaEntrada[]): Map<string, Perdedora> {
  const ganadoras = new Map<string, CapturaEntrada>();
  for (const c of candidatas) {
    const llave = llaveDato(c);
    const actual = ganadoras.get(llave);
    if (!actual || new Date(c.capturedAt).getTime() > new Date(actual.capturedAt).getTime()) {
      ganadoras.set(llave, c);
    }
  }
  const perdedoras = new Map<string, Perdedora>();
  for (const c of candidatas) {
    const ganadora = ganadoras.get(llaveDato(c))!;
    if (ganadora !== c) perdedoras.set(c.captureId, { ganadora });
  }
  return perdedoras;
}
