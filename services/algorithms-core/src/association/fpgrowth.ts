/**
 * M10 — FP-Growth (Han, Pei y Yin, 2000) como función pura, con la misma
 * firma que `apriori()` (D2, RF-14).
 *
 * Encuentra los mismos itemsets frecuentes que Apriori sin generar
 * candidatos: comprime las canastas en un árbol de prefijos (árbol FP) y lo
 * recorre por sufijos. Las reglas y su orden salen de `buildResult`, el mismo
 * código que usa Apriori: con los mismos datos y umbrales, los dos dan las
 * mismas reglas en el mismo orden.
 */
import {
  AprioriParams,
  AprioriResult,
  buildResult,
  checkThresholds,
  compareItems,
  FrequentItemset,
  minCountOf,
} from './apriori';

/** Un producto en un camino del árbol, con cuántas canastas pasan por él. */
interface FpNode {
  item: string;
  count: number;
  parent: FpNode | null;
  children: Map<string, FpNode>;
}

/** Productos de una canasta (o de un prefijo) y cuántas canastas lo siguen. */
interface Path {
  items: string[];
  count: number;
}

export function fpGrowth(baskets: string[][], params: AprioriParams): AprioriResult {
  checkThresholds(params);
  const { minSupport, minConfidence, maxItemsetSize } = params;

  const total = baskets.length;
  if (total === 0) return { itemsets: [], rules: [] };

  const minCount = minCountOf(minSupport, total);
  const itemsets: FrequentItemset[] = [];

  // Un producto repetido en la misma canasta cuenta una sola vez.
  mine(
    baskets.map((basket) => ({ items: [...new Set(basket)], count: 1 })),
    [],
  );

  return buildResult(itemsets, total, minConfidence);

  /**
   * Registra los itemsets frecuentes que terminan en `suffix`: cada producto
   * frecuente de `paths` más el sufijo, y sigue con la base condicional de
   * ese producto (los caminos que llevan a él) hasta `maxItemsetSize`.
   */
  function mine(paths: Path[], suffix: string[]) {
    for (const [item, nodes] of buildTree(paths, minCount)) {
      const count = nodes.reduce((sum, node) => sum + node.count, 0);
      const items = [item, ...suffix];
      itemsets.push({ items: [...items].sort(), count, support: count / total });
      if (items.length >= maxItemsetSize) continue;
      mine(
        nodes.map((node) => ({ items: prefixOf(node), count: node.count })),
        items,
      );
    }
  }
}

/**
 * Orden de los productos en el árbol: frecuencia descendente y, en empate,
 * id de producto. Sin el desempate, la forma del árbol dependería del orden
 * de las canastas (D-15).
 */
export function itemOrder(counts: Map<string, number>, minCount: number): string[] {
  return [...counts]
    .filter(([, count]) => count >= minCount)
    .sort(([a, countA], [b, countB]) => countB - countA || compareItems([a], [b]))
    .map(([item]) => item);
}

/**
 * Árbol FP de unos caminos: solo los productos frecuentes en ellos, en el
 * orden de `itemOrder`, con los prefijos comunes compartidos. Devuelve, por
 * producto y en ese orden, todos sus nodos.
 */
function buildTree(paths: Path[], minCount: number): Map<string, FpNode[]> {
  const counts = new Map<string, number>();
  for (const { items, count } of paths) {
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + count);
  }
  const order = itemOrder(counts, minCount);
  const rank = new Map(order.map((item, n) => [item, n]));

  const root: FpNode = { item: '', count: 0, parent: null, children: new Map() };
  const header = new Map<string, FpNode[]>(order.map((item) => [item, []]));
  for (const { items, count } of paths) {
    let node = root;
    const ordered = items.filter((item) => rank.has(item)).sort((a, b) => rank.get(a)! - rank.get(b)!);
    for (const item of ordered) {
      let child = node.children.get(item);
      if (!child) {
        child = { item, count: 0, parent: node, children: new Map() };
        node.children.set(item, child);
        header.get(item)!.push(child);
      }
      child.count += count;
      node = child;
    }
  }
  return header;
}

/** Productos del camino de la raíz al nodo, sin el nodo. */
function prefixOf(node: FpNode): string[] {
  const items: string[] = [];
  for (let up = node.parent; up?.parent; up = up.parent) items.push(up.item);
  return items.reverse();
}
