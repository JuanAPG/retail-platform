/**
 * Zona horaria del negocio: decide en qué DÍA cae cada venta. Una compra
 * a las 18:40 en Monterrey es 00:40 del día siguiente en UTC; cortar los
 * días en UTC la contaría en el día equivocado.
 *
 * Se aplica en dos lugares, que deben coincidir:
 * - La sesión de Postgres (`database.config.ts`): todo el SQL que agrupa o
 *   filtra por día o semana corta a medianoche local.
 * - `fechaLocal`, para las fechas que se arman en TypeScript.
 *
 * Una zona inválida impide que el servicio arranque (Postgres la rechaza
 * al conectar): mejor eso que agrupar mal sin aviso.
 */
export const ZONA_HORARIA = process.env.ZONA_HORARIA || 'America/Monterrey';

const FORMATO = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Día 'yyyy-mm-dd' de un instante en la zona del negocio. */
export function fechaLocal(instante: Date): string {
  return FORMATO.format(instante);
}
