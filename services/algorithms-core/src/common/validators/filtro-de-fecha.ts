import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

/**
 * Validación de `dateFrom`/`dateTo`: copia de `EsFiltroDeFecha` de
 * core-process-service (`src/common/zona-horaria.ts`), para que el mismo
 * filtro responda igual en los dos servicios. Si allá cambia, aquí también.
 */

/** Forma de un filtro de fecha: un día, con hora opcional que se ignora. */
const FORMA_FILTRO_FECHA = /^(\d{4})-(\d{2})-(\d{2})([T ].*)?$/;

/**
 * ¿Sirve como `dateFrom`/`dateTo`? Un día real (`2026-09-01`), o un ISO
 * completo del que solo se usará el día (los primeros 10 caracteres).
 *
 * `@IsDateString()` aceptaba `2026`, `2026-W40-1`, `2026-273` y hasta
 * `2026-09-31`: ninguno se puede castear a `date` en Postgres, así que
 * respondía 500 en vez de 400 (QA-ALG56-02). El día se valida de verdad
 * (no solo su forma): septiembre no tiene 31.
 */
export function esFiltroDeFecha(valor: unknown): boolean {
  if (typeof valor !== 'string') return false;
  const partes = FORMA_FILTRO_FECHA.exec(valor);
  if (!partes) return false;
  const [, anio, mes, dia] = partes;
  const fecha = new Date(Date.UTC(2000, Number(mes) - 1, Number(dia)));
  fecha.setUTCFullYear(Number(anio));
  return (
    fecha.getUTCFullYear() === Number(anio) &&
    fecha.getUTCMonth() === Number(mes) - 1 &&
    fecha.getUTCDate() === Number(dia)
  );
}

/** `@Validate(EsFiltroDeFecha)` en los DTO con `dateFrom`/`dateTo`. */
@ValidatorConstraint({ name: 'esFiltroDeFecha', async: false })
export class EsFiltroDeFecha implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    return esFiltroDeFecha(valor);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} debe ser una fecha YYYY-MM-DD existente (el filtro es por día completo).`;
  }
}

/**
 * El día de un filtro ya validado: 'YYYY-MM-DD' sin la hora, si la traía.
 * Con este formato, comparar el texto es comparar las fechas.
 */
export function diaDelFiltro(valor: string): string;
export function diaDelFiltro(valor: string | undefined): string | undefined;
export function diaDelFiltro(valor: string | undefined): string | undefined {
  return valor?.slice(0, 10);
}
