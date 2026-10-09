import { registerDecorator, ValidationOptions } from 'class-validator';

/** `YYYY-MM-DD` que existe en el calendario: rechaza 2026-13-45, 2026-02-30 y 0000-00-00 antes de llegar a Postgres. */
export function esFechaCalendario(valor: unknown): boolean {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [anio, mes, dia] = valor.split('-').map(Number);
  if (anio < 1) return false;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

export function IsFechaCalendario(opciones?: ValidationOptions) {
  return (objeto: object, propiedad: string) =>
    registerDecorator({
      name: 'isFechaCalendario',
      target: objeto.constructor,
      propertyName: propiedad,
      options: opciones,
      validator: { validate: esFechaCalendario },
    });
}

const ISO = /^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Fecha ISO 8601 (YYYY-MM-DD o con hora) que EXISTE: `IsDateString` acepta 2026-02-30 y Postgres la rechaza al
 * castearla (500). Se exige que el día exista en el calendario y que la hora sea válida.
 */
export function esFechaIso(valor: unknown): boolean {
  if (typeof valor !== 'string') return false;
  const m = ISO.exec(valor);
  if (!m || !esFechaCalendario(m[1])) return false;
  return !Number.isNaN(Date.parse(valor));
}

export function IsFechaIso(opciones?: ValidationOptions) {
  return (objeto: object, propiedad: string) =>
    registerDecorator({
      name: 'isFechaIso',
      target: objeto.constructor,
      propertyName: propiedad,
      options: opciones,
      validator: { validate: esFechaIso },
    });
}
