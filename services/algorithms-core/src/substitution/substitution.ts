import { lift, pearsonCorrelation, roundTo } from '../elasticity/elasticity.math';
import { SubstitutionPattern } from './dto/substitution-pattern.dto';

/**
 * M11 — Patrones de sustitución (RF-17), trasladado de
 * `api/src/elasticity/substitution.service.ts` sin cambiar la detección.
 * Funciones puras: sin base de datos, se prueban con canastas armadas a mano.
 *
 * El método (correlación simple del Sprint 1) es el que fija el contrato;
 * RN-11 deja PENDIENTE (PR-5) si se cambia a elasticidad cruzada.
 */

/** Con menos canastas, "nunca juntos" sería casualidad: lift 0 con 2 compras. */
export const MIN_BASKETS_PER_PRODUCT = 2;
/** Correlación a partir de la cual el precio de A se considera asociado a comprar B. */
export const PRICE_CORRELATION_MIN = 0.3;
/**
 * Si por azar se esperaba verlos juntos menos de una vez, no verlos
 * juntos no es evidencia de sustitución.
 */
export const MIN_EXPECTED_TOGETHER = 1;

export interface CandidateProduct {
  id: string;
  name: string;
}

/** Una canasta vista por la sustitución: qué productos llevó y cuánto costaban. */
export interface SubstitutionBasket {
  /** Productos de la categoría que llevó la canasta. */
  products: Set<string>;
  /** Precio vigente (pricing) de la presentación principal de cada producto, en esa tienda y ese día. */
  prices: Map<string, number>;
}

export type DetectedPattern = Omit<SubstitutionPattern, 'periodStart' | 'periodEnd'>;

export interface PriceRow {
  store: string;
  price: number;
  /** 'yyyy-mm-dd' */
  from: string;
  /** 'yyyy-mm-dd'; null = sigue vigente. */
  until: string | null;
}

/** Precio vigente en una tienda y un día; si hay traslape, el de vigencia más reciente. */
export function priceInEffect(rows: PriceRow[], store: string, day: string): number | null {
  const valid = rows
    .filter((r) => r.store === store && r.from <= day && (r.until === null || r.until >= day))
    .sort((a, b) => b.from.localeCompare(a.from));
  return valid.length > 0 ? Number(valid[0].price) : null;
}

/** Evidencia de un par (QA ALG-03): cómo cambió el precio de A y qué pasó con A y B. */
export interface Evidence {
  /** (máximo − mínimo) / mínimo del precio de A en el periodo; null si A no tiene precios. */
  priceVariation: number | null;
  /** Proporción de canastas que llevan A con A caro menos con A barato; null si su precio no cambió. */
  originFrequencyChange: number | null;
  /** Lo mismo para B: si sube cuando A está caro, es indicio de que se compra en su lugar. */
  targetFrequencyChange: number | null;
}

/**
 * "Caro" y "barato" se separan en el punto medio entre el precio mínimo y
 * el máximo de A: funciona igual con dos niveles de precio que con precios
 * continuos, y los dos grupos nunca quedan vacíos si el precio cambió.
 * Solo cuentan las canastas en que se conoce el precio vigente de A.
 */
export function evidenceOf(origin: CandidateProduct, target: CandidateProduct, baskets: SubstitutionBasket[]): Evidence {
  const priced = baskets.filter((k) => k.prices.has(origin.id));
  if (priced.length === 0) return { priceVariation: null, originFrequencyChange: null, targetFrequencyChange: null };
  const priceOf = (k: SubstitutionBasket) => k.prices.get(origin.id)!;
  // reduce y no Math.min(...): con decenas de miles de canastas el spread revienta la pila.
  const min = priced.reduce((m, k) => Math.min(m, priceOf(k)), Infinity);
  const max = priced.reduce((m, k) => Math.max(m, priceOf(k)), -Infinity);
  const priceVariation = roundTo((max - min) / min, 4);
  if (max === min) return { priceVariation, originFrequencyChange: null, targetFrequencyChange: null };

  const midpoint = (min + max) / 2;
  const expensive = priced.filter((k) => priceOf(k) > midpoint);
  const cheap = priced.filter((k) => priceOf(k) <= midpoint);
  const share = (group: SubstitutionBasket[], id: string) => group.filter((k) => k.products.has(id)).length / group.length;
  return {
    priceVariation,
    originFrequencyChange: roundTo(share(expensive, origin.id) - share(cheap, origin.id), 4),
    targetFrequencyChange: roundTo(share(expensive, target.id) - share(cheap, target.id), 4),
  };
}

/**
 * Núcleo de la detección, sin base de datos. Solo cuentan las canastas
 * que compraron algo de la categoría: la sustitución es una elección
 * DENTRO de la categoría ("¿qué leche me llevo?"), y una canasta sin
 * lácteos no dice nada de esa elección. Para cada par de productos:
 *  1. Regla: lift < 1 (se compran juntos menos de lo esperado). Si no,
 *     se complementan y el par se descarta. Además se exige que por azar
 *     se esperara verlos juntos al menos una vez.
 *  2. Correlación: precio vigente de A contra "la canasta llevó B". Si
 *     r ≥ 0.3, B sustituye a A cuando A sube → tipo 'precio' (dirigido).
 *  Sin evidencia de precio, el par es 'preferencia' (simétrico, una vez).
 * Es un INDICIO de sustitución, no una causa: solo describe cómo se compró.
 */
export function findSubstitutes(products: CandidateProduct[], allBaskets: SubstitutionBasket[]): DetectedPattern[] {
  const baskets = allBaskets.filter((b) => b.products.size > 0);
  const total = baskets.length;
  const count = (id: string) => baskets.filter((b) => b.products.has(id)).length;
  const eligible = products
    .map((p) => ({ ...p, baskets: count(p.id) }))
    .filter((p) => p.baskets >= MIN_BASKETS_PER_PRODUCT)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const patterns: DetectedPattern[] = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      if ((a.baskets * b.baskets) / total < MIN_EXPECTED_TOGETHER) continue;
      const both = baskets.filter((k) => k.products.has(a.id) && k.products.has(b.id)).length;
      const pairLift = lift(a.baskets, b.baskets, both, total);
      if (pairLift === null || pairLift >= 1) continue;
      const ruleSignal = 1 - pairLift;

      const correlations = [
        [a, b],
        [b, a],
      ].map(([origin, target]) => {
        const priced = baskets.filter((k) => k.prices.has(origin.id));
        const r = pearsonCorrelation(
          priced.map((k) => k.prices.get(origin.id)!),
          priced.map((k) => (k.products.has(target.id) ? 1 : 0)),
        );
        return { origin, target, r };
      });

      const byPrice = correlations.filter((c) => c.r !== null && c.r >= PRICE_CORRELATION_MIN);
      for (const { origin, target, r } of byPrice) {
        patterns.push(pattern(origin, target, 'precio', (ruleSignal + r!) / 2, pairLift, r, total, baskets));
      }
      if (byPrice.length === 0) {
        // Simétrico: una sola vez, con origen = el que aparece en más canastas.
        const [origin, target] = a.baskets >= b.baskets ? [a, b] : [b, a];
        const r = correlations.find((c) => c.origin.id === origin.id)!.r;
        patterns.push(pattern(origin, target, 'preferencia', ruleSignal, pairLift, r, total, baskets));
      }
    }
  }

  return patterns.sort(
    (x, y) =>
      y.score - x.score ||
      x.originProductName.localeCompare(y.originProductName, 'es') ||
      x.targetProductName.localeCompare(y.targetProductName, 'es'),
  );
}

/** La frase del patrón: siempre "indicio", nunca causa (QA ALG-03). */
function summaryOf(origin: CandidateProduct, target: CandidateProduct, type: DetectedPattern['type'], pairLift: number, r: number | null): string {
  return type === 'precio'
    ? `Indicio de sustitución por precio: cuando ${origin.name} estuvo más caro, más canastas llevaron ${target.name} ` +
        `(r = ${roundTo(r!, 2)}). No prueba que una cosa cause la otra.`
    : `Indicio de sustitución por preferencia: ${origin.name} y ${target.name} casi no se compran juntos ` +
        `(lift = ${roundTo(pairLift, 2)}), sin relación clara con el precio. No prueba que una cosa cause la otra.`;
}

function pattern(
  origin: CandidateProduct,
  target: CandidateProduct,
  type: DetectedPattern['type'],
  score: number,
  pairLift: number,
  r: number | null,
  observations: number,
  baskets: SubstitutionBasket[],
): DetectedPattern {
  return {
    originProductId: origin.id,
    originProductName: origin.name,
    targetProductId: target.id,
    targetProductName: target.name,
    type,
    score: roundTo(score, 4),
    lift: roundTo(pairLift, 4),
    priceCorrelation: r === null ? null : roundTo(r, 4),
    observations,
    ...evidenceOf(origin, target, baskets),
    summary: summaryOf(origin, target, type, pairLift, r),
  };
}
