import { BadRequestException } from '@nestjs/common';

/**
 * Reglas puras de los segmentos de ingreso (sin base de datos), para poder
 * probarlas con casos de control: rangos (D-10) y qué cambia entre una
 * versión y la siguiente (D-35).
 */

/** Los valores que se versionan. `code` no está: identifica al segmento y no cambia. */
export interface ValoresSegmento {
  name: string;
  /** Cadena decimal con 2 decimales, como `numeric(12,2)`. */
  incomeRangeMin: string;
  /** `null` = sin tope superior. */
  incomeRangeMax: string | null;
  source: string;
  updateFrequency: string;
  zoneRelation: string;
  limitations: string;
  description: string | null;
}

export interface CambiosSegmento {
  name?: string;
  incomeRangeMin?: number;
  /** `null` explícito quita el tope. */
  incomeRangeMax?: number | null;
  source?: string;
  updateFrequency?: string;
  zoneRelation?: string;
  limitations?: string;
  /** `null` explícito borra la descripción. */
  description?: string | null;
}

export interface Rango {
  code: string;
  min: number;
  /** `null` = sin tope superior. */
  max: number | null;
}

/** Nombre de cada valor en la tabla, para la bitácora (`cambios[].campo`). */
const COLUMNA: Record<keyof ValoresSegmento, string> = {
  name: 'nombre',
  incomeRangeMin: 'ingreso_min',
  incomeRangeMax: 'ingreso_max',
  source: 'fuente',
  updateFrequency: 'frecuencia_actualizacion',
  zoneRelation: 'relacion_zona',
  limitations: 'limitaciones',
  description: 'descripcion',
};

/** `15000` → `"15000.00"`, igual que lo devuelve Postgres. */
export function decimal(valor: number): string {
  return valor.toFixed(2);
}

/** Dos rangos se enciman si `a.min ≤ b.max` y `b.min ≤ a.max`, con "sin tope" como infinito. */
export function seEnciman(a: Omit<Rango, 'code'>, b: Omit<Rango, 'code'>): boolean {
  return a.min <= (b.max ?? Infinity) && b.min <= (a.max ?? Infinity);
}

/**
 * D-10 / D-35: mínimo negativo, mínimo ≥ máximo o un rango que se encima con
 * el de otro segmento → 400. `otros` son los rangos VIGENTES de los demás
 * segmentos (sin el que se está editando).
 */
export function validarRango(min: number, max: number | null, otros: Rango[]): void {
  if (min < 0) {
    throw new BadRequestException('incomeRangeMin no puede ser negativo.');
  }
  if (max !== null && min >= max) {
    throw new BadRequestException('incomeRangeMin debe ser menor que incomeRangeMax.');
  }
  const choque = otros.find((otro) => seEnciman({ min, max }, otro));
  if (choque) {
    throw new BadRequestException(
      `El rango se encima con el segmento ${choque.code} (${decimal(choque.min)} a ${
        choque.max === null ? 'sin tope' : decimal(choque.max)
      }). Los rangos no pueden encimarse (D-10).`,
    );
  }
}

/**
 * Aplica lo que trae el PATCH sobre la versión vigente. Devuelve los valores
 * resultantes y la lista de lo que cambió DE VERDAD: si está vacía no se crea
 * versión nueva (mandar el mismo valor no es un cambio).
 */
export function aplicarCambios(
  vigente: ValoresSegmento,
  cambios: CambiosSegmento,
): { valores: ValoresSegmento; cambios: Array<{ campo: string; previo: string | null; posterior: string | null }> } {
  const valores: ValoresSegmento = {
    name: cambios.name ?? vigente.name,
    incomeRangeMin: cambios.incomeRangeMin != null ? decimal(cambios.incomeRangeMin) : vigente.incomeRangeMin,
    incomeRangeMax:
      cambios.incomeRangeMax === undefined
        ? vigente.incomeRangeMax
        : cambios.incomeRangeMax === null
          ? null
          : decimal(cambios.incomeRangeMax),
    source: cambios.source ?? vigente.source,
    updateFrequency: cambios.updateFrequency ?? vigente.updateFrequency,
    zoneRelation: cambios.zoneRelation ?? vigente.zoneRelation,
    limitations: cambios.limitations ?? vigente.limitations,
    description: cambios.description === undefined ? vigente.description : cambios.description,
  };
  const diferencias = (Object.keys(COLUMNA) as Array<keyof ValoresSegmento>)
    .filter((campo) => valores[campo] !== vigente[campo])
    .map((campo) => ({ campo: COLUMNA[campo], previo: vigente[campo], posterior: valores[campo] }));
  return { valores, cambios: diferencias };
}
