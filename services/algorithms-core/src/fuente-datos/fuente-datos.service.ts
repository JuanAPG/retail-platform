import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Filtros de canastas: mismos nombres que `AnalyticsFilterDto` (M09). */
export interface FiltrosCanastas {
  storeId?: string;
  zoneId?: string;
  segmentId?: number;
  dateFrom?: string;
  dateTo?: string;
}

/** Un renglón por (canasta, producto); mismos campos que en M10 del monolito. */
export interface LineaCanasta {
  basketId: string;
  productId: string;
  categoryId: number;
  /** 'yyyy-mm-dd' */
  day: string;
}

/** Lo que una regla muestra de cada producto (`product` en el contrato). */
export interface ResumenProducto {
  id: string;
  sku: string;
  nombre: string;
  categoriaId: number;
}

/**
 * Canastas con sus productos. Mismos criterios que `loadBasketLines` de M10:
 * - DISTINCT: dos presentaciones del mismo producto son un solo producto.
 * - Zona y segmento salen de la CANASTA (clasificación vigente al momento
 *   de la compra, RN-02); la tienda, de la transacción. Cada canasta tiene
 *   exactamente una transacción, así que unirla siempre no cambia filas.
 * - `dateTo` inclusivo: `canastas.fecha` lleva hora, `< dateTo + 1` abarca
 *   el día completo.
 */
const LINEAS_DE_CANASTA_SQL = `
  SELECT DISTINCT k.id AS "basketId", p.id AS "productId", p.categoria_id AS "categoryId",
         to_char(k.fecha, 'YYYY-MM-DD') AS "day"
  FROM canastas k
  JOIN transacciones t ON t.id = k.transaccion_id
  JOIN transacciones_detalle d ON d.transaccion_id = k.transaccion_id
  JOIN producto_presentaciones pp ON pp.id = d.presentacion_id
  JOIN productos p ON p.id = pp.producto_id
  WHERE ($1::uuid IS NULL OR k.zona_id = $1::uuid)
    AND ($2::smallint IS NULL OR k.segmento_ingreso_id = $2::smallint)
    AND ($3::uuid IS NULL OR t.tienda_id = $3::uuid)
    AND ($4::timestamptz IS NULL OR k.fecha >= $4::timestamptz)
    AND ($5::date IS NULL OR k.fecha < $5::date + 1)`;

/**
 * Única puerta de algorithms-core a datos de OTROS servicios: canastas
 * (core-process), productos y presentaciones (catalog) y usuarios (auth).
 *
 * Fase B: SQL de solo lectura sobre el Postgres compartido. Fase C: estas
 * mismas firmas pasan a llamar por HTTP a esos servicios, sin tocar a
 * quienes las usan. Las tablas propias (corridas, reglas, exclusiones,
 * elasticidades) NO se leen aquí: se leen con sus entidades.
 */
@Injectable()
export class FuenteDatos {
  constructor(private readonly dataSource: DataSource) {}

  async lineasDeCanasta(filtros: FiltrosCanastas): Promise<LineaCanasta[]> {
    const rows: LineaCanasta[] = await this.dataSource.query(LINEAS_DE_CANASTA_SQL, [
      filtros.zoneId ?? null,
      filtros.segmentId ?? null,
      filtros.storeId ?? null,
      filtros.dateFrom ?? null,
      filtros.dateTo ?? null,
    ]);
    return rows.map((row) => ({ ...row, categoryId: Number(row.categoryId) }));
  }

  /** Nombre de cada usuario; los ids que no existan no aparecen en el mapa. */
  async nombresDeUsuarios(ids: string[]): Promise<Map<string, string>> {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) return new Map();
    const rows: { id: string; nombre: string }[] = await this.dataSource.query(
      'SELECT id, nombre FROM usuarios WHERE id = ANY($1::uuid[])',
      [unicos],
    );
    return new Map(rows.map((row) => [row.id, row.nombre]));
  }

  /** Resumen de cada producto; los ids que no existan no aparecen en el mapa. */
  async resumenDeProductos(ids: string[]): Promise<Map<string, ResumenProducto>> {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) return new Map();
    const rows: ResumenProducto[] = await this.dataSource.query(
      'SELECT id, sku, nombre, categoria_id AS "categoriaId" FROM productos WHERE id = ANY($1::uuid[])',
      [unicos],
    );
    return new Map(rows.map((row) => [row.id, { ...row, categoriaId: Number(row.categoriaId) }]));
  }
}
