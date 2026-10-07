/**
 * Fechas y números de M06, compartidos por el alta manual y el CSV para
 * que las dos puertas de entrada apliquen la MISMA regla.
 *
 * Antes la validación de fecha futura comparaba cadenas
 * (`texto.slice(0,10) > hoy`), así que `"12/31/2099"` pasaba como válida:
 * `"1" < "2"`. Aquí se compara el instante ya interpretado.
 */

/** Último milisegundo del día de `ahora`, en UTC. */
function finDelDia(ahora: Date): number {
  return Date.UTC(
    ahora.getUTCFullYear(),
    ahora.getUTCMonth(),
    ahora.getUTCDate(),
    23,
    59,
    59,
    999,
  );
}

/**
 * Una venta no puede estar fechada después de hoy. Se tolera el día
 * completo en curso (hasta 23:59:59.999Z) para no rechazar capturas del
 * mismo día hechas desde una zona horaria distinta a la del servidor.
 */
export function esFechaFutura(fecha: Date, ahora: Date = new Date()): boolean {
  return fecha.getTime() > finDelDia(ahora);
}

/** `null` si el texto no es una fecha interpretable. */
export function parsearFecha(texto: string): Date | null {
  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Número decimal estricto para celdas de CSV: `Number()` admite
 * notaciones que un archivo de ventas no debería traer (`1e3` → 1000,
 * `0x10` → 16, `Infinity`). Devuelve `null` si no es un decimal plano o si
 * excede los 2 decimales que admiten las columnas NUMERIC(_,2).
 */
export function parsearDecimal(texto: string | null): number | null {
  if (texto == null) return null;
  const limpio = texto.trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(limpio)) return null;
  const valor = Number(limpio);
  return Number.isFinite(valor) ? valor : null;
}
