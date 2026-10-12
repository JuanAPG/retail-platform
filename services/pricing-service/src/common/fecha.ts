/**
 * Huso en el que opera el negocio. La base corre en UTC: sin esto, entre las 18:00 y las 24:00 locales
 * `CURRENT_DATE` ya es "mañana" y un precio fechado mañana aparece como el actual (QA-PRI53-02).
 */
export const ZONA_HORARIA_OPERACION = 'America/Monterrey';

/** "Hoy" en SQL, en el huso de operación. */
export const HOY_SQL = `(now() AT TIME ZONE '${ZONA_HORARIA_OPERACION}')::date`;

/** "Hoy" (YYYY-MM-DD) en el huso de operación; `en-CA` formatea año-mes-día. */
export function hoyOperacion(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA_OPERACION,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}
