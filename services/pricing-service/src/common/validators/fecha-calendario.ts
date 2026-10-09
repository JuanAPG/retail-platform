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
