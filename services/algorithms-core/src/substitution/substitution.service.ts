import { Injectable, NotFoundException } from '@nestjs/common';
import { FuenteDatos, PrecioHistorico } from '../fuente-datos/fuente-datos.service';
import { SubstitutionPattern } from './dto/substitution-pattern.dto';
import { findSubstitutes, PriceRow, priceInEffect, SubstitutionBasket } from './substitution';

/**
 * M11 — Patrones de sustitución (RF-17), "mediante reglas y correlaciones
 * simples". Se calcula al vuelo y no se guarda: un GET no debe crear
 * registros. Trasladado del monolito; las lecturas de otros servicios
 * pasan por FuenteDatos.
 */
@Injectable()
export class SubstitutionService {
  constructor(private readonly fuente: FuenteDatos) {}

  async detectPatterns(categoryId: number): Promise<SubstitutionPattern[]> {
    if (!(await this.fuente.categoriaExiste(categoryId))) {
      throw new NotFoundException(`No existe la categoría ${categoryId}.`);
    }

    // Solo la categoría directa (sin subcategorías), igual que el gasto por categoría de M09.
    const products = await this.fuente.productosDeCategoria(categoryId);
    if (products.length < 2) return [];
    const deLaCategoria = new Set(products.map((p) => p.id));

    const [canastas, precios] = await Promise.all([
      this.fuente.canastasConProductos([...deLaCategoria]),
      this.fuente.historialDePrecios([...deLaCategoria]),
    ]);
    // Solo productos de la categoría aunque la fuente mandara otros: un par
    // nunca cruza categorías (QA ALG-03).
    const baskets = canastas
      .map((c) => ({ ...c, products: c.products.filter((p) => deLaCategoria.has(p)) }))
      .filter((c) => c.products.length > 0);
    if (baskets.length === 0) return [];

    // Periodo de las canastas que sí se analizan: las que compraron la categoría.
    const days = baskets.map((b) => b.day).sort();
    const period = { periodStart: days[0], periodEnd: days[days.length - 1] };

    const preciosPorProducto = agrupar(precios);
    const view: SubstitutionBasket[] = baskets.map((basket) => {
      const prices = new Map<string, number>();
      for (const productId of deLaCategoria) {
        const price = priceInEffect(preciosPorProducto.get(productId) ?? [], basket.store, basket.day);
        if (price !== null) prices.set(productId, price);
      }
      return { products: new Set(basket.products), prices };
    });

    return findSubstitutes(products, view).map((pattern) => ({ ...pattern, ...period }));
  }
}

function agrupar(rows: PrecioHistorico[]): Map<string, PriceRow[]> {
  const porProducto = new Map<string, PriceRow[]>();
  for (const { productId, ...row } of rows) {
    porProducto.set(productId, [...(porProducto.get(productId) ?? []), row]);
  }
  return porProducto;
}
