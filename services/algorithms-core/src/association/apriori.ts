/**
 * M10 — Algoritmo Apriori (Agrawal & Srikant, 1994) como función pura:
 * sin base de datos, sin HTTP, sin exclusiones de negocio. Recibe canastas
 * como listas de ids de producto y devuelve itemsets frecuentes y reglas.
 *
 * Aislado a propósito: se puede verificar contra ejemplos con respuesta
 * conocida, y si el cálculo se extrae después a un servicio en Python la
 * lógica ya está separada del resto del módulo.
 *
 * Determinista: con las mismas canastas y parámetros devuelve las mismas
 * reglas en el mismo orden. Es condición para reproducir una corrida.
 */

export interface AprioriParams {
  /** Fracción mínima de canastas (0–1] que debe contener un itemset. */
  minSupport: number;
  /** Confianza mínima (0–1) de una regla. */
  minConfidence: number;
  /** Tamaño máximo de un itemset (≥ 2 para que haya reglas). */
  maxItemsetSize: number;
}

export interface FrequentItemset {
  /** Ids ordenados. */
  items: string[];
  /** Canastas que contienen todo el itemset. */
  count: number;
  support: number;
}

export interface AprioriRule {
  /** Ids ordenados. */
  antecedent: string[];
  /** Ids ordenados. */
  consequent: string[];
  /** Soporte de antecedente ∪ consecuente. */
  support: number;
  /** soporte(A ∪ B) / soporte(A). */
  confidence: number;
  /** confianza / soporte(B); > 1 = asociación positiva. */
  lift: number;
  /** Canastas que contienen la regla completa. */
  count: number;
}

export interface AprioriResult {
  itemsets: FrequentItemset[];
  rules: AprioriRule[];
}

/**
 * Tolerancia para comparar umbrales: 0.1 * 30 da 3.0000000000000004 en
 * punto flotante, y sin ella exigiría 4 canastas en lugar de 3.
 */
const EPSILON = 1e-9;

export function apriori(baskets: string[][], params: AprioriParams): AprioriResult {
  checkThresholds(params);
  const { minSupport, minConfidence, maxItemsetSize } = params;

  const total = baskets.length;
  if (total === 0) return { itemsets: [], rules: [] };

  // Un producto repetido en la misma canasta cuenta una sola vez.
  const transactions = baskets.map((basket) => new Set(basket));
  const minCount = minCountOf(minSupport, total);

  /** Conteo de cada itemset frecuente, por llave. Lo usan los candidatos. */
  const counts = new Map<string, number>();
  const itemsets: FrequentItemset[] = [];

  // --- Nivel 1: productos individuales -------------------------------
  const singles = new Map<string, number>();
  for (const transaction of transactions) {
    for (const item of transaction) singles.set(item, (singles.get(item) ?? 0) + 1);
  }
  let level: string[][] = [...singles.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([item]) => [item])
    .sort(compareItems);
  for (const items of level) record(items, singles.get(items[0])!);

  // --- Niveles 2..maxItemsetSize ---------------------------------------
  for (let size = 2; size <= maxItemsetSize && level.length > 1; size++) {
    const candidates = generateCandidates(level, counts);
    const candidateCounts = candidates.map(() => 0);
    for (const transaction of transactions) {
      if (transaction.size < size) continue;
      candidates.forEach((candidate, i) => {
        if (candidate.every((item) => transaction.has(item))) candidateCounts[i]++;
      });
    }
    level = candidates.filter((_, i) => candidateCounts[i] >= minCount);
    candidates.forEach((candidate, i) => {
      if (candidateCounts[i] >= minCount) record(candidate, candidateCounts[i]);
    });
  }

  return buildResult(itemsets, total, minConfidence);

  function record(items: string[], count: number) {
    counts.set(key(items), count);
    itemsets.push({ items, count, support: count / total });
  }
}

// --- Común a Apriori y FP-Growth -----------------------------------------

/** Soporte y confianza en (0, 1] (D-17): la regla no depende solo del DTO. */
export function checkThresholds({ minSupport, minConfidence }: AprioriParams): void {
  if (!(minSupport > 0 && minSupport <= 1)) {
    // Con soporte 0 toda combinación sería frecuente y el cálculo explota.
    throw new RangeError('minSupport debe estar en (0, 1].');
  }
  if (!(minConfidence > 0 && minConfidence <= 1)) {
    throw new RangeError('minConfidence debe estar en (0, 1].');
  }
}

/**
 * El soporte mínimo en canastas. Se calcula una sola vez; así no se comparan
 * decimales en cada paso.
 */
export function minCountOf(minSupport: number, total: number): number {
  return Math.max(1, Math.ceil(minSupport * total - EPSILON));
}

/**
 * Reglas a partir de los itemsets frecuentes, y el orden final de los dos.
 * Apriori y FP-Growth solo difieren en cómo encuentran los itemsets: esta
 * parte es la misma, así que con los mismos datos dan las mismas reglas en
 * el mismo orden (RF-14).
 */
export function buildResult(itemsets: FrequentItemset[], total: number, minConfidence: number): AprioriResult {
  const counts = new Map(itemsets.map((itemset) => [key(itemset.items), itemset.count]));
  const rules: AprioriRule[] = [];
  for (const itemset of itemsets) {
    if (itemset.items.length < 2) continue;
    for (const [antecedent, consequent] of splits(itemset.items)) {
      // Todo subconjunto de un itemset frecuente también es frecuente, así
      // que su conteo ya está en el mapa.
      const antecedentCount = counts.get(key(antecedent))!;
      const consequentCount = counts.get(key(consequent))!;
      if (itemset.count < minConfidence * antecedentCount - EPSILON) continue;

      const confidence = itemset.count / antecedentCount;
      rules.push({
        antecedent,
        consequent,
        support: itemset.support,
        confidence,
        lift: confidence / (consequentCount / total),
        count: itemset.count,
      });
    }
  }

  rules.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      b.lift - a.lift ||
      b.support - a.support ||
      compareItems(a.antecedent, b.antecedent) ||
      compareItems(a.consequent, b.consequent),
  );
  const sorted = [...itemsets].sort(
    (a, b) => a.items.length - b.items.length || b.count - a.count || compareItems(a.items, b.items),
  );

  return { itemsets: sorted, rules };
}

/**
 * Candidatos de tamaño k a partir de los frecuentes de tamaño k-1 (ordenados):
 * se unen dos que comparten los primeros k-2 productos, y se descarta el
 * candidato si alguno de sus subconjuntos de tamaño k-1 no es frecuente
 * (propiedad Apriori: nada que contenga un conjunto infrecuente puede ser
 * frecuente).
 */
function generateCandidates(previous: string[][], frequent: Map<string, number>): string[][] {
  const candidates: string[][] = [];
  for (let i = 0; i < previous.length; i++) {
    for (let j = i + 1; j < previous.length; j++) {
      const a = previous[i];
      const b = previous[j];
      const prefix = a.length - 1;
      if (!a.slice(0, prefix).every((item, n) => item === b[n])) break;

      const candidate = [...a, b[prefix]];
      const allSubsetsFrequent = candidate.every((_, skip) =>
        frequent.has(key(candidate.filter((__, n) => n !== skip))),
      );
      if (allSubsetsFrequent) candidates.push(candidate);
    }
  }
  return candidates;
}

/** Todas las divisiones antecedente → consecuente con ambos lados no vacíos. */
function splits(items: string[]): [string[], string[]][] {
  const result: [string[], string[]][] = [];
  const full = (1 << items.length) - 1;
  for (let mask = 1; mask < full; mask++) {
    const antecedent = items.filter((_, n) => mask & (1 << n));
    const consequent = items.filter((_, n) => !(mask & (1 << n)));
    result.push([antecedent, consequent]);
  }
  return result;
}

function key(items: string[]): string {
  return items.join('|');
}

/** Orden lexicográfico de listas de ids; base del determinismo. */
export function compareItems(a: string[], b: string[]): number {
  for (let n = 0; n < Math.min(a.length, b.length); n++) {
    if (a[n] !== b[n]) return a[n] < b[n] ? -1 : 1;
  }
  return a.length - b.length;
}
