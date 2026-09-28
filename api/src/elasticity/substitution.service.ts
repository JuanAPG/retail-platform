import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SubstitutionPattern } from './dto/substitution-pattern.dto';
import { lift, pearsonCorrelation, roundTo } from './elasticity.math';

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
  /** Precio vigente (M08) de la presentación principal de cada producto, en esa tienda y ese día. */
  prices: Map<string, number>;
}

export type DetectedPattern = Omit<SubstitutionPattern, 'periodStart' | 'periodEnd'>;

/**
 * M11 — Patrones de sustitución (S1-16) "mediante reglas y correlaciones
 * simples", según Contrato de Métodos y Endpoints. Se calcula al vuelo y
 * no se guarda: un GET no debe crear registros.
 */
@Injectable()
export class SubstitutionService {
  constructor(private readonly dataSource: DataSource) {}

  async detectPatterns(categoryId: string): Promise<SubstitutionPattern[]> {
    const id = Number(categoryId);
    const [category] = Number.isInteger(id)
      ? await this.dataSource.query('SELECT id FROM categorias_producto WHERE id = $1', [id])
      : [];
    if (!category) throw new NotFoundException(`No existe la categoría ${categoryId}.`);

    // Solo la categoría directa (sin subcategorías), igual que el gasto por categoría de M09.
    const products: CandidateProduct[] = await this.dataSource.query(
      'SELECT id, nombre AS name FROM productos WHERE categoria_id = $1',
      [id],
    );
    if (products.length < 2) return [];
    const productIds = products.map((p) => p.id);

    // findSubstitutes se queda solo con las que compraron la categoría.
    const baskets: { store: string; day: string; products: string[] }[] = await this.dataSource.query(
      `SELECT t.tienda_id AS store, to_char(k.fecha, 'YYYY-MM-DD') AS day,
              array_agg(DISTINCT pp.producto_id) AS products
       FROM canastas k
       JOIN transacciones t ON t.id = k.transaccion_id
       JOIN transacciones_detalle d ON d.transaccion_id = k.transaccion_id
       JOIN producto_presentaciones pp ON pp.id = d.presentacion_id
       GROUP BY k.id, t.tienda_id, k.fecha`,
    );
    if (baskets.length === 0) return [];

    const prices = await this.loadPriceHistory(productIds);
    // Periodo de las canastas que sí se analizan: las que compraron la categoría.
    const days = baskets
      .filter((b) => b.products.some((p) => productIds.includes(p)))
      .map((b) => b.day)
      .sort();
    if (days.length === 0) return [];
    const period = { periodStart: days[0], periodEnd: days[days.length - 1] };

    const view: SubstitutionBasket[] = baskets.map((basket) => {
      const inBasket = new Set(basket.products.filter((p) => productIds.includes(p)));
      const pricesAtBasket = new Map<string, number>();
      for (const productId of productIds) {
        const price = priceInEffect(prices.get(productId) ?? [], basket.store, basket.day);
        if (price !== null) pricesAtBasket.set(productId, price);
      }
      return { products: inBasket, prices: pricesAtBasket };
    });

    return findSubstitutes(products, view).map((pattern) => ({ ...pattern, ...period }));
  }

  /**
   * Histórico de precios (M08) de la presentación PRINCIPAL de cada
   * producto (la más vendida), para no mezclar el precio de 1 kg con el
   * de 500 g. Del histórico y no de las ventas: cuando A está caro nadie
   * lo compra, y su precio no aparecería en ninguna venta.
   */
  private async loadPriceHistory(productIds: string[]): Promise<Map<string, PriceRow[]>> {
    const rows: (PriceRow & { productId: string })[] = await this.dataSource.query(
      `WITH principal AS (
         SELECT DISTINCT ON (pp.producto_id) pp.producto_id, pp.id AS presentacion_id
         FROM producto_presentaciones pp
         LEFT JOIN transacciones_detalle d ON d.presentacion_id = pp.id
         WHERE pp.producto_id = ANY($1::uuid[])
         GROUP BY pp.producto_id, pp.id
         ORDER BY pp.producto_id, COALESCE(SUM(d.cantidad), 0) DESC, pp.id
       )
       SELECT pr.producto_id AS "productId", p.tienda_id AS store, p.precio::float8 AS price,
              p.fecha_vigencia_desde::text AS "from", p.fecha_vigencia_hasta::text AS "until"
       FROM principal pr
       JOIN precios p ON p.presentacion_id = pr.presentacion_id`,
      [productIds],
    );
    const byProduct = new Map<string, PriceRow[]>();
    for (const row of rows) {
      const list = byProduct.get(row.productId) ?? [];
      list.push(row);
      byProduct.set(row.productId, list);
    }
    return byProduct;
  }
}

interface PriceRow {
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
        patterns.push(pattern(origin, target, 'precio', (ruleSignal + r!) / 2, pairLift, r, total));
      }
      if (byPrice.length === 0) {
        // Simétrico: una sola vez, con origen = el que aparece en más canastas.
        const [origin, target] = a.baskets >= b.baskets ? [a, b] : [b, a];
        const r = correlations.find((c) => c.origin.id === origin.id)!.r;
        patterns.push(pattern(origin, target, 'preferencia', ruleSignal, pairLift, r, total));
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

function pattern(
  origin: CandidateProduct,
  target: CandidateProduct,
  type: DetectedPattern['type'],
  score: number,
  pairLift: number,
  r: number | null,
  observations: number,
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
  };
}
