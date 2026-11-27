/*
 * Formato de números para mostrar en pantalla (es-MX: miles con coma, decimales con punto).
 * Un valor nulo se muestra como «—», nunca como 0.
 */

export const VACIO = '—';

const nulo = (n: number | null | undefined): n is null | undefined => n === null || n === undefined || Number.isNaN(n);

/** $1,234.50 */
export function mxn(n: number | null | undefined): string {
  return nulo(n) ? VACIO : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

/** 12,345 o 12,345.67 (hasta `decimales`). */
export function miles(n: number | null | undefined, decimales = 2): string {
  return nulo(n) ? VACIO : n.toLocaleString('es-MX', { maximumFractionDigits: decimales });
}

/** Número con decimales fijos: 0.9500 */
export function fijo(n: number | null | undefined, decimales: number): string {
  return nulo(n) ? VACIO : n.toLocaleString('es-MX', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

/** Un porcentaje que ya viene en escala 0–100: 11.11 → "11.11 %". */
export function pct(n: number | null | undefined, decimales = 2): string {
  return nulo(n) ? VACIO : `${n.toLocaleString('es-MX', { maximumFractionDigits: decimales })} %`;
}

/** Una proporción 0–1 como porcentaje: 0.95 → "95 %". */
export function proporcion(n: number | null | undefined, decimales = 1): string {
  return nulo(n) ? VACIO : pct(n * 100, decimales);
}

/** Convierte lo que llegue (número o texto decimal) a número, o null. */
export function aNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
