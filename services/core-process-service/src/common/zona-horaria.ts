import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * Huso del negocio. Una fecha sin huso —la que escribe quien captura una
 * venta, la que trae un CSV de punto de venta, la que manda un `<input
 * type="date">`— es un reloj de pared de aquí, no de UTC.
 *
 * Mismo criterio que `audit-service` (`AUDIT_TIMEZONE`): el día es el día
 * local de quien lee y captura, no el día del servidor de base de datos.
 */
export const ZONA_HORARIA = process.env.CORE_PROCESS_TIMEZONE ?? 'America/Monterrey';

// Una zona mal escrita haría que `Intl` lanzara RangeError en CADA fecha
// (500 en toda alta e importación) y que Postgres fallara en los filtros.
// Mejor que no arranque, con el motivo claro.
try {
  new Intl.DateTimeFormat('en-US', { timeZone: ZONA_HORARIA }).format(new Date());
} catch {
  throw new Error(
    `CORE_PROCESS_TIMEZONE no es una zona horaria válida: "${ZONA_HORARIA}". ` +
      'Usa un nombre de la base IANA, p. ej. America/Monterrey.',
  );
}

/**
 * El día (`YYYY-MM-DD`) en que cae un instante, visto en `ZONA_HORARIA`.
 *
 * `fecha.toISOString().slice(0, 10)` da el día UTC, que no es el mismo:
 * una venta de las 21:00 del 30 de septiembre se etiquetaría como 1 de
 * octubre, que no es la fecha que el usuario escribió ni la que verá en
 * el reporte.
 */
export function diaLocal(instante: Date): string {
  // 'sv-SE' formatea como YYYY-MM-DD, que es justo lo que se necesita.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/** Forma de un filtro de fecha: un día, con hora opcional que se ignora. */
const FORMA_FILTRO_FECHA = /^(\d{4})-(\d{2})-(\d{2})([T ].*)?$/;

/**
 * ¿Sirve como `dateFrom`/`dateTo`? Un día real (`2026-09-01`), o un ISO
 * completo del que solo se usará el día.
 *
 * `@IsDateString()` aceptaba `2026`, `2026-W40-1`, `2026-273` y hasta
 * `2026-09-31`: ninguno se puede castear a `date` en Postgres, así que el
 * filtro respondía 500 en vez de 400. El día se valida de verdad (no solo
 * su forma): septiembre no tiene 31.
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

/** `@Validate(EsFiltroDeFecha)` en los DTO de filtros. */
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
 * `dateFrom`/`dateTo` como DÍAS COMPLETOS locales, los dos inclusivos,
 * sobre una columna `timestamptz`.
 *
 * Los límites se construyen con `AT TIME ZONE` y no con el huso de la
 * sesión de Postgres (UTC en el compose): si no, "el 1 de septiembre"
 * significa 00:00Z, o sea el 31 de agosto a las 18:00 en Monterrey, y una
 * venta de las 21:00 del día 1 cae en el día siguiente. Antes, además,
 * los dos extremos no se trataban igual: `dateFrom` se comparaba en crudo
 * (respetaba la hora si venía) y `dateTo` se truncaba a día.
 */
export function filtrarDiasLocales<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  columna: string,
  filtros: { dateFrom?: string; dateTo?: string },
): void {
  if (filtros.dateFrom) {
    qb.andWhere(`${columna} >= CAST(:dateFrom AS date)::timestamp AT TIME ZONE :zona`, {
      // Solo el día: el extremo es un día completo, así que una hora en el
      // parámetro no significaría nada y además el CAST la descartaría.
      dateFrom: filtros.dateFrom.slice(0, 10),
      zona: ZONA_HORARIA,
    });
  }
  if (filtros.dateTo) {
    qb.andWhere(`${columna} < (CAST(:dateTo AS date) + 1)::timestamp AT TIME ZONE :zona`, {
      dateTo: filtros.dateTo.slice(0, 10),
      zona: ZONA_HORARIA,
    });
  }
}
