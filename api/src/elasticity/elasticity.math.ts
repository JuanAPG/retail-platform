/**
 * M11 — Matemática de elasticidad y sustitución como funciones puras:
 * sin base de datos ni HTTP. Aislada para verificarla contra respuestas
 * conocidas y para poder llevarla a un servicio en Python si algún día
 * se extrae el cálculo.
 */

/** Con 2 puntos la recta pasa exacta por ambos (R² = 1 siempre): no significa nada. */
export const MIN_OBSERVATIONS = 3;
/** Sin variación de precio no hay forma de medir cómo reacciona la demanda. */
export const MIN_DISTINCT_PRICES = 2;

/**
 * Umbrales de la columna generada `elasticidades.clasificacion`. Deben
 * coincidir exactamente con schema.sql, o la API diría "elástica" donde
 * la base dice "unitaria".
 */
export const ELASTIC_ABOVE = 1.05;
export const INELASTIC_BELOW = 0.95;
/** La base guarda la elasticidad como numeric(10,4). */
export const ELASTICITY_DECIMALS = 4;

/** Por debajo de esto una suma de cuadrados es cero salvo ruido de punto flotante. */
const EPSILON = 1e-12;

export interface PriceQuantity {
  price: number;
  quantity: number;
}

export type InsufficientReason = 'single-price' | 'few-observations' | 'invalid-values';

export type RegressionOutcome =
  | {
      ok: true;
      /** Pendiente de ln(cantidad) contra ln(precio): la elasticidad E. */
      elasticity: number;
      intercept: number;
      /** null si la cantidad no varió (0 ÷ 0). */
      rSquared: number | null;
      observations: number;
      distinctPrices: number;
    }
  | { ok: false; reason: InsufficientReason; observations: number; distinctPrices: number };

/**
 * Elasticidad precio-demanda por mínimos cuadrados sobre el modelo
 * cantidad = A · precio^E, que en logaritmos es la recta
 * ln(cantidad) = a + E · ln(precio): la pendiente es E.
 *
 * Si los datos no la justifican devuelve el motivo en lugar de un número.
 */
export function logLogRegression(observations: PriceQuantity[]): RegressionOutcome {
  const n = observations.length;
  // Se compara a 4 decimales: los precios promedio de un periodo pueden
  // arrastrar ruido de punto flotante.
  const distinctPrices = new Set(observations.map((o) => roundTo(o.price, 4))).size;

  if (observations.some((o) => !(o.price > 0) || !(o.quantity > 0))) {
    return { ok: false, reason: 'invalid-values', observations: n, distinctPrices };
  }
  // Primero el precio: es la causa de fondo (más observaciones al mismo
  // precio no lo arreglarían).
  if (distinctPrices < MIN_DISTINCT_PRICES) {
    return { ok: false, reason: 'single-price', observations: n, distinctPrices };
  }
  if (n < MIN_OBSERVATIONS) {
    return { ok: false, reason: 'few-observations', observations: n, distinctPrices };
  }

  const xs = observations.map((o) => Math.log(o.price));
  const ys = observations.map((o) => Math.log(o.quantity));
  const { sxx, syy, sxy, meanX, meanY } = sums(xs, ys);

  // Cantidad constante: la recta es horizontal y el R² no está definido.
  const elasticity = syy < EPSILON ? 0 : sxy / sxx;
  const rSquared = syy < EPSILON ? null : clamp((sxy * sxy) / (sxx * syy), 0, 1);

  return {
    ok: true,
    elasticity,
    intercept: meanY - elasticity * meanX,
    rSquared,
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
  if (xs.length !== ys.length || xs.length < MIN_OBSERVATIONS) return null;
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
