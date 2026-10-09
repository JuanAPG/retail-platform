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

/** Cómo se agrupan las ventas en observaciones de elasticidad. */
export type Granularidad = 'day' | 'week';

/** Filtros de ventas para elasticidad: mismos nombres que `ElasticityParamsDto` (M11). */
export interface FiltrosVentas {
  presentationId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Ventas de una presentación en una zona y un periodo; mismos campos que `SalesRow` de M11. */
export interface VentaAgregada {
  presentationId: string;
  zoneId: string;
  period: string;
  quantity: number;
  /** Σ cantidad × precio: permite promediar el precio ponderado por unidades. */
  revenue: number;
}

export interface VentasElasticidad {
  rows: VentaAgregada[];
  baskets: number;
  /** 'yyyy-mm-dd'; null si no hubo ventas. */
  firstDay: string | null;
  lastDay: string | null;
}

export interface NombrePresentacion {
  product: string;
  presentation: string;
}

export interface Zona {
  id: string;
  nombre: string;
}

export interface Segmento {
  id: number;
  nombre: string;
}

/** Periodo de cada observación; la semana es ISO (empieza en lunes). */
const PERIODO_SQL: Record<Granularidad, string> = {
  day: `to_char(fecha, 'YYYY-MM-DD')`,
  week: `to_char(date_trunc('week', fecha), 'YYYY-MM-DD')`,
};

/**
 * Líneas de venta con zona y fecha de la CANASTA (clasificación vigente al
 * momento de la compra), igual que `loadSales` de M11; el precio es el
 * cobrado en cada línea. `dateTo` inclusivo: abarca el día completo.
 */
const LINEAS_VENTA_SQL = `
  SELECT d.presentacion_id, k.zona_id, k.id AS canasta_id, k.fecha, d.cantidad, d.precio_unitario
  FROM transacciones_detalle d
  JOIN canastas k ON k.transaccion_id = d.transaccion_id
  WHERE ($1::uuid IS NULL OR d.presentacion_id = $1::uuid)
    AND ($2::date IS NULL OR k.fecha >= $2::date)
    AND ($3::date IS NULL OR k.fecha < $3::date + 1)`;

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

  /**
   * Ventas por presentación × zona × periodo (elasticidad, M11), más las
   * canastas y el rango de días que respaldan el cálculo.
   */
  async ventasParaElasticidad(filtros: FiltrosVentas, granularidad: Granularidad): Promise<VentasElasticidad> {
    const args = [filtros.presentationId ?? null, filtros.dateFrom ?? null, filtros.dateTo ?? null];
    const [rows, [resumen]] = await Promise.all([
      this.dataSource.query(
        `WITH lineas AS (${LINEAS_VENTA_SQL})
         SELECT presentacion_id AS "presentationId", zona_id AS "zoneId",
                ${PERIODO_SQL[granularidad]} AS "period",
                SUM(cantidad)::float8 AS "quantity",
                SUM(cantidad * precio_unitario)::float8 AS "revenue"
         FROM lineas
         GROUP BY 1, 2, 3`,
        args,
      ) as Promise<VentaAgregada[]>,
      this.dataSource.query(
        `WITH lineas AS (${LINEAS_VENTA_SQL})
         SELECT COUNT(DISTINCT canasta_id)::int AS "baskets",
                to_char(MIN(fecha), 'YYYY-MM-DD') AS "firstDay",
                to_char(MAX(fecha), 'YYYY-MM-DD') AS "lastDay"
         FROM lineas`,
        args,
      ) as Promise<{ baskets: number; firstDay: string | null; lastDay: string | null }[]>,
    ]);
    return { rows, ...resumen };
  }

  /** Producto y presentación de cada id; los que no existan no aparecen. */
  async nombresDePresentaciones(ids: string[]): Promise<Map<string, NombrePresentacion>> {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) return new Map();
    const rows: { id: string; product: string; presentation: string }[] = await this.dataSource.query(
      `SELECT pp.id, p.nombre AS product, pp.nombre AS presentation
       FROM producto_presentaciones pp JOIN productos p ON p.id = pp.producto_id
       WHERE pp.id = ANY($1::uuid[])`,
      [unicos],
    );
    return new Map(rows.map((r) => [r.id, { product: r.product, presentation: r.presentation }]));
  }

  /**
   * Zonas activas más las inactivas indicadas (las que tienen datos), por
   * nombre: así una zona dada de baja no desaparece de un resultado.
   */
  async zonas(conDatos: string[] = []): Promise<Zona[]> {
    return this.dataSource.query(
      'SELECT id, nombre FROM zonas WHERE activo OR id = ANY($1::uuid[]) ORDER BY nombre',
      [[...new Set(conDatos)]],
    );
  }

  /** Segmentos de ingreso, de menor a mayor ingreso mínimo. */
  async segmentos(): Promise<Segmento[]> {
    const rows: { id: number; nombre: string }[] = await this.dataSource.query(
      'SELECT id, nombre FROM segmentos_ingreso ORDER BY ingreso_min',
    );
    return rows.map((r) => ({ id: Number(r.id), nombre: r.nombre }));
  }

  /**
   * Segmento vigente de cada zona (null si no tiene clasificación), en una
   * sola consulta. Misma regla que `ZonesService.findSegmentId` del
   * monolito: el segmento manual si existe, si no el del clustering. Hay a
   * lo más una clasificación vigente por zona (uq_zona_clasificacion_vigente).
   */
  async segmentosDeZonas(zoneIds: string[]): Promise<Map<string, number | null>> {
    const unicos = [...new Set(zoneIds)];
    const resultado = new Map<string, number | null>(unicos.map((id) => [id, null]));
    if (unicos.length === 0) return resultado;
    const rows: { zoneId: string; segmentId: number | null }[] = await this.dataSource.query(
      `SELECT zc.zona_id AS "zoneId", s.id AS "segmentId"
       FROM zona_clasificaciones zc
       LEFT JOIN corrida_clusters cc
             ON cc.corrida_id = zc.corrida_id AND cc.cluster_valor = zc.cluster_valor
       LEFT JOIN segmentos_ingreso s
             ON s.id = COALESCE(zc.segmento_manual_id, cc.segmento_ingreso_id)
       WHERE zc.zona_id = ANY($1::uuid[]) AND zc.vigente`,
      [unicos],
    );
    for (const r of rows) resultado.set(r.zoneId, r.segmentId === null ? null : Number(r.segmentId));
    return resultado;
  }
}
