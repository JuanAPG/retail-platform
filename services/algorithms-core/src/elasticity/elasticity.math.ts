/**
 * M11 — Matemática de elasticidad y sustitución como funciones puras:
 * sin base de datos ni HTTP. Aislada para verificarla contra respuestas
 * conocidas y para poder llevarla a un servicio en Python si algún día
 * se extrae el cálculo.
 */

/**
 * Mínimos para PUBLICAR una elasticidad (decididos en este dominio, Sprint 4, ver el contrato
 * `algorithms-core.md`). Antes eran 3 observaciones y 2 precios: con 3 puntos una sola semana
 * atípica mueve la pendiente a cualquier valor (se vieron hasta E = 77.86). Con 8 observaciones y
 * 3 precios distintos la recta deja de depender de un punto. Frontera: 7 → no calculable; 8 → sí.
 */
export const MIN_OBSERVATIONS = 8;
export const MIN_DISTINCT_PRICES = 3;
/** Pares mínimos de la correlación de Pearson (sustitución): no cambia con los mínimos de arriba. */
export const MIN_PARES_CORRELACION = 3;

export interface ReglasElasticidad {
  minObservaciones: number;
  minPreciosDistintos: number;
}

/** Las reglas vigentes. Las pruebas de la fórmula (casos de QA de 3 puntos) pasan las suyas. */
export const REGLAS_ELASTICIDAD: ReglasElasticidad = {
  minObservaciones: MIN_OBSERVATIONS,
  minPreciosDistintos: MIN_DISTINCT_PRICES,
};

/**
 * Umbrales de la columna generada `elasticidades.clasificacion`. Deben
 * coincidir exactamente con schema.sql, o la API diría "elástica" donde
 * la base dice "unitaria".
 */
export const ELASTIC_ABOVE = 1.05;
export const INELASTIC_BELOW = 0.95;
/** La base guarda la elasticidad como numeric(10,4). */
export const ELASTICITY_DECIMALS = 4;
/** Dos precios iguales al centavo son el mismo precio (el promedio ponderado arrastra decimales). */
export const PRICE_DECIMALS = 2;

/** Por debajo de esto una suma de cuadrados es cero salvo ruido de punto flotante. */
const EPSILON = 1e-12;

export interface PriceQuantity {
  price: number;
  quantity: number;
  /**
   * Grupo de la observación (la zona). Si viene, la pendiente se estima DENTRO de cada grupo
   * (efectos fijos): las diferencias de nivel entre zonas no se leen como efecto del precio.
   */
  group?: string;
}

export type InsufficientReason =
  | 'single-price'
  | 'few-prices'
  | 'few-observations'
  | 'invalid-values'
  | 'constant-quantity';

export type RegressionOutcome =
  | {
      ok: true;
      /** Pendiente de ln(cantidad) contra ln(precio): la elasticidad E. */
      elasticity: number;
      intercept: number;
      rSquared: number;
      observations: number;
      distinctPrices: number;
    }
  | { ok: false; reason: InsufficientReason; observations: number; distinctPrices: number };

export interface AjusteLogLog {
  elasticity: number;
  intercept: number;
  /** null si la cantidad no varió (0 ÷ 0). */
  rSquared: number | null;
  /** Variación del ln(precio) usada (dentro de cada grupo si hay grupos). */
  sxx: number;
  /** Variación del ln(cantidad) usada (dentro de cada grupo si hay grupos). */
  syy: number;
}

/**
 * Ajuste por mínimos cuadrados de ln(cantidad) = a + E · ln(precio), SIN reglas de publicación:
 * es la fórmula que verifican los casos de QA (referencia scipy `linregress`).
 *
 * Con `group` en las observaciones, cada grupo se centra en su propia media antes de ajustar
 * (estimador "within" de efectos fijos): la pendiente sale solo de cómo cambia la demanda cuando
 * el precio cambia DENTRO de una zona. Sin grupos (o con uno solo) es la regresión de siempre.
 */
export function ajustarLogLog(observations: PriceQuantity[]): AjusteLogLog {
  const xs = observations.map((o) => Math.log(o.price));
  const ys = observations.map((o) => Math.log(o.quantity));
  const grupos = new Map<string, number[]>();
  observations.forEach((o, i) => {
    const clave = o.group ?? '';
    grupos.set(clave, [...(grupos.get(clave) ?? []), i]);
  });
  const dx = new Array<number>(xs.length);
  const dy = new Array<number>(ys.length);
  for (const indices of grupos.values()) {
    const mx = indices.reduce((a, i) => a + xs[i], 0) / indices.length;
    const my = indices.reduce((a, i) => a + ys[i], 0) / indices.length;
    for (const i of indices) {
      dx[i] = xs[i] - mx;
      dy[i] = ys[i] - my;
    }
  }
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += dx[i] * dx[i];
    syy += dy[i] * dy[i];
    sxy += dx[i] * dy[i];
  }
  const elasticity = sxx < EPSILON || syy < EPSILON ? 0 : sxy / sxx;
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  return {
    elasticity,
    intercept: meanY - elasticity * meanX,
    rSquared: sxx < EPSILON || syy < EPSILON ? null : clamp((sxy * sxy) / (sxx * syy), 0, 1),
    sxx,
    syy,
  };
}

/**
 * Elasticidad precio-demanda publicable, sobre el modelo cantidad = A · precio^E (la pendiente de
 * `ajustarLogLog`). Si los datos no la justifican devuelve el motivo en lugar de un número: nunca
 * un 0 inventado (D-18: sin variación de precio → error claro, nunca Infinity ni NaN).
 */
export function logLogRegression(
  observations: PriceQuantity[],
  reglas: ReglasElasticidad = REGLAS_ELASTICIDAD,
): RegressionOutcome {
  const n = observations.length;
  // Al centavo: el promedio ponderado de un periodo arrastra decimales que no son otro precio.
  const distinctPrices = new Set(observations.map((o) => roundTo(o.price, PRICE_DECIMALS))).size;
  const sin = (reason: InsufficientReason): RegressionOutcome => ({ ok: false, reason, observations: n, distinctPrices });

  if (observations.some((o) => !(o.price > 0) || !(o.quantity > 0))) return sin('invalid-values');
  // Primero el precio: es la causa de fondo (más observaciones al mismo precio no lo arreglarían).
  if (distinctPrices < 2) return sin('single-price');
  if (distinctPrices < reglas.minPreciosDistintos) return sin('few-prices');
  if (n < reglas.minObservaciones) return sin('few-observations');

  const ajuste = ajustarLogLog(observations);
  // Precios distintos ENTRE zonas pero fijos dentro de cada una: no hay variación que medir.
  if (ajuste.sxx < EPSILON) return sin('single-price');
  // Cantidad constante: la recta es horizontal y no dice nada; antes salía E = 0 "inelástica".
  if (ajuste.syy < EPSILON || ajuste.rSquared === null) return sin('constant-quantity');

  return {
    ok: true,
    elasticity: ajuste.elasticity,
    intercept: ajuste.intercept,
    rSquared: ajuste.rSquared,
    observations: n,
    distinctPrices,
  };
}

/**
 * Clasificación con los mismos umbrales que la base. Redondea a 4
 * decimales antes de comparar porque la base clasifica el valor ya
 * guardado en numeric(10,4): 1.05004 se guarda como 1.0500 → unitaria.
 * Quien guarde el valor debe guardar este mismo redondeo.
 */
export function classifyElasticity(value: number): 'elastic' | 'inelastic' | 'unitary' {
  const magnitude = Math.abs(roundTo(value, ELASTICITY_DECIMALS));
  if (magnitude > ELASTIC_ABOVE) return 'elastic';
  if (magnitude < INELASTIC_BELOW) return 'inelastic';
  return 'unitary';
}

/**
 * Correlación de Pearson (−1 a 1). null con menos de 3 pares o si alguna
 * serie no varía: la división no está definida.
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < MIN_PARES_CORRELACION) return null;
  const { sxx, syy, sxy } = sums(xs, ys);
  if (sxx < EPSILON || syy < EPSILON) return null;
  return clamp(sxy / Math.sqrt(sxx * syy), -1, 1);
}

/**
 * P(A y B) / (P(A) · P(B)) para cualquier par, también los que casi
 * nunca se compran juntos (Apriori los descarta por soporte bajo y ahí
 * viven los sustitutos). < 1 = juntos menos de lo esperado.
 */
export function lift(countA: number, countB: number, countBoth: number, total: number): number | null {
  if (total <= 0 || countA <= 0 || countB <= 0) return null;
  return (countBoth * total) / (countA * countB);
}

/** Redondeo "mitad lejos de cero", el mismo que aplica Postgres a NUMERIC. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

function sums(xs: number[], ys: number[]) {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return { sxx, syy, sxy, meanX, meanY };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
