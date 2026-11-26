/**
 * Reglas del contrato (§4 estados, §8 evaluación), sin E/S: lo que prueban
 * los casos de control.
 */
import { ROL } from '../common/roles';

// ============================ Estados (§4, D-41) ============================

/** En orden: asignada → en_implementacion → implementada → evaluada. */
export const ESTADOS = ['asignada', 'en_implementacion', 'implementada', 'evaluada'] as const;
export type Estado = (typeof ESTADOS)[number];

/** Las tres transiciones con ruta (la asignación crea el seguimiento). */
export type Transicion = 'en_implementacion' | 'implementada' | 'evaluada';

/** De qué estado sale cada transición. */
export const DESDE: Record<Transicion, Estado> = {
  en_implementacion: 'asignada',
  implementada: 'en_implementacion',
  evaluada: 'implementada',
};

/** Nombre del evento de cada transición (`seguimiento_eventos.evento`). */
export const EVENTO: Record<Estado, 'asignada' | 'iniciada' | 'implementada' | 'evaluada'> = {
  asignada: 'asignada',
  en_implementacion: 'iniciada',
  implementada: 'implementada',
  evaluada: 'evaluada',
};

/**
 * §2 (PROPUESTA): quién puede ser responsable asignado. El Gerente evalúa y no
 * implementa; Administrador y Auditor son perfiles de control.
 */
export const ROLES_ASIGNABLES = [ROL.ANALISTA, ROL.RESPONSABLE_PRECIOS, ROL.PLANEADOR] as const;

const indice = (e: Estado) => ESTADOS.indexOf(e);

/**
 * `null` si la transición procede. Si no, el 409 del contrato: salto fuera de
 * orden o transición repetida, con el estado actual y el pedido en `details`.
 */
export function conflictoDeTransicion(actual: Estado, pedida: Transicion): { message: string; details: string[] } | null {
  if (actual === DESDE[pedida]) return null;
  const repetida = indice(actual) >= indice(pedida);
  return {
    message: repetida ? 'Transición repetida: el seguimiento ya pasó por ese estado.' : 'Transición fuera de orden.',
    details: [`estado actual: ${actual}`, `transición pedida: ${pedida}`, pista(actual, pedida, repetida)],
  };
}

function pista(actual: Estado, pedida: Transicion, repetida: boolean): string {
  if (repetida) {
    return { en_implementacion: 'ya se inició (start)', implementada: 'ya se marcó implementada', evaluada: 'ya se evaluó' }[pedida];
  }
  if (pedida === 'implementada') return 'primero se inicia (start)';
  // pedida === 'evaluada'
  return actual === 'asignada' ? 'primero se inicia (start) y luego se marca implementada' : 'falta marcarla implementada';
}

// ============================ Evaluación (§8) ============================

export const METRICAS = ['ventas_unidades', 'ventas_importe', 'precio_unitario'] as const;
export type Metrica = (typeof METRICAS)[number];

export const UNIDADES = ['pza', 'MXN', 'MXN/kg', 'MXN/l', 'MXN/pza'] as const;
export type Unidad = (typeof UNIDADES)[number];

/** §8: la unidad debe corresponder a la métrica. */
export const UNIDADES_POR_METRICA: Record<Metrica, readonly Unidad[]> = {
  ventas_unidades: ['pza'],
  ventas_importe: ['MXN'],
  precio_unitario: ['MXN/kg', 'MXN/l', 'MXN/pza'],
};

export interface Periodo {
  from: string;
  to: string;
  value: number;
}

export interface Evaluacion {
  metric: Metrica;
  unit: Unidad;
  scope: { zoneId?: string; storeId?: string; presentationId?: string };
  before: Periodo;
  after: Periodo;
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `true` si es `YYYY-MM-DD` y el día existe. */
export function esFecha(fecha: string): boolean {
  const m = FECHA.exec(fecha);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Días de un periodo, los dos extremos inclusivos (`2026-10-02`…`2026-10-31` = 30). */
export function diasInclusivos(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function lista(unidades: readonly string[]): string {
  return unidades.length === 1 ? unidades[0] : `${unidades.slice(0, -1).join(', ')} o ${unidades[unidades.length - 1]}`;
}

/**
 * Reglas de §8 que dependen del seguimiento (día de implementación) y de hoy.
 * `incompatibles` va con el mensaje "Unidades incompatibles."; `errores`, con
 * "Datos inválidos.". Las fechas `YYYY-MM-DD` se comparan como texto.
 */
export function revisarEvaluacion(ev: Evaluacion, implementedOn: string, hoy: string): { incompatibles: string[]; errores: string[] } {
  const incompatibles: string[] = [];
  const permitidas = UNIDADES_POR_METRICA[ev.metric];
  if (!permitidas.includes(ev.unit)) {
    incompatibles.push(`unit ${ev.unit} no corresponde a la métrica ${ev.metric} (usa ${lista(permitidas)})`);
  }

  const errores: string[] = [];
  const { zoneId, storeId, presentationId } = ev.scope ?? {};
  if (!zoneId && !storeId && !presentationId) errores.push('scope debe traer al menos uno de zoneId, storeId o presentationId');
  if (ev.metric === 'precio_unitario' && !presentationId) {
    errores.push('precio_unitario exige scope.presentationId (D-06: nunca se mezclan presentaciones)');
  }

  const fechasValidas = (['before', 'after'] as const).every((p) => {
    const ok = esFecha(ev[p].from) && esFecha(ev[p].to);
    if (!ok) errores.push(`${p}.from y ${p}.to deben ser fechas YYYY-MM-DD válidas`);
    return ok;
  });
  if (fechasValidas) {
    if (ev.before.from > ev.before.to) errores.push('before.from no puede ser posterior a before.to');
    if (ev.after.from > ev.after.to) errores.push('after.from no puede ser posterior a after.to');
    if (!(ev.before.to < implementedOn)) errores.push(`before.to debe ser anterior al día de implementación (${implementedOn})`);
    if (!(implementedOn <= ev.after.from)) errores.push(`after.from no puede ser anterior al día de implementación (${implementedOn})`);
    if (ev.after.to > hoy) errores.push(`after.to no puede ser futuro (hoy es ${hoy})`);
    const dAntes = diasInclusivos(ev.before.from, ev.before.to);
    const dDespues = diasInclusivos(ev.after.from, ev.after.to);
    if (ev.before.from <= ev.before.to && ev.after.from <= ev.after.to && dAntes !== dDespues) {
      errores.push(`before y after deben durar lo mismo (${dAntes} días contra ${dDespues})`);
    }
  }
  if (!(ev.before.value > 0)) errores.push('before.value debe ser mayor a 0: sin base no hay variación definida');
  if (ev.metric === 'precio_unitario' && !(ev.after.value > 0)) errores.push('after.value debe ser mayor a 0 en precio_unitario');
  return { incompatibles, errores };
}

/**
 * Redondeo "mitad hacia arriba" (el .5 se aleja del cero, como `round()` de
 * PostgreSQL con `numeric`), por la notación `e` para no arrastrar el error
 * binario. Igual que promotion-service.
 */
export function redondear(valor: number, decimales: number): number {
  if (!Number.isFinite(valor)) throw new Error(`No se puede redondear ${valor}.`);
  const signo = valor < 0 ? -1 : 1;
  const escalado = Math.round(Number(`${Math.abs(valor)}e${decimales}`));
  const resultado = signo * Number(`${escalado}e-${decimales}`);
  return resultado === 0 ? 0 : resultado;
}

/**
 * §8: `variationPct = (after − before) / before × 100`, redondeado a 2
 * decimales SOLO al final. Sin base (`before` ≤ 0) lanza: nunca Infinity ni NaN
 * (quien llama ya respondió 400 antes).
 */
export function variacionPct(antes: number, despues: number): number {
  if (!(antes > 0)) throw new Error('Sin base no hay variación definida.');
  return redondear(((despues - antes) / antes) * 100, 2);
}
