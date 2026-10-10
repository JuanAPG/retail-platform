import { ValidateBy, ValidationOptions } from 'class-validator';

/**
 * ¿Es `valor` una fecha de calendario real con formato 'aaaa-mm-dd'?
 *
 * `@IsDateString` acepta cualquier ISO 8601: '2026' (solo año), '2026-09',
 * '2026-W40-1' (semana) y hasta '2026-02-30'. Esas entradas llegaban a
 * Postgres como `::date` y respondían 500. Aquí solo pasa una fecha que
 * existe: el día se reconstruye y debe ser el mismo.
 */
export function esFechaCalendario(valor: unknown): boolean {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [anio, mes, dia] = valor.split('-').map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

/**
 * Fecha sin hora ('aaaa-mm-dd') que existe en el calendario. Con este
 * formato, comparar el texto equivale a comparar las fechas.
 */
export function IsFechaCalendario(opciones?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isFechaCalendario',
      validator: {
        validate: esFechaCalendario,
        defaultMessage: (args) => `${args?.property ?? 'La fecha'} debe ser una fecha real con formato aaaa-mm-dd.`,
      },
    },
    opciones,
  );
}
