import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Basket } from '../entities/basket.entity';
import { TransactionDetail } from '../entities/transaction-detail.entity';
import { AnalyticsFilterDto } from './dto/analytics-filter.dto';
import { CategorySpend } from './dto/category-spend.dto';

/**
 * M09 — Indicadores descriptivos, según Contrato de Métodos y Endpoints.
 *
 * Se calculan sobre `canastas` (M07) y no sobre `transacciones`: la
 * canasta ya trae valor total, productos y unidades precalculados, y
 * además la zona y el segmento vigentes al momento de construirla.
 * Las fórmulas son las mismas que documenta el catálogo `indicadores`
 * (ver db/data_retail.sql).
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Basket)
    private readonly basketsRepo: Repository<Basket>,
  ) {}

  /** sum(valor_total) / count(canastas), en MXN. */
  getAverageTicket(filters: AnalyticsFilterDto): Promise<number> {
    return this.averageOf('totalValue', filters);
  }

  /** sum(numero_productos) / count(canastas). */
  getProductsPerBasket(filters: AnalyticsFilterDto): Promise<number> {
    return this.averageOf('productCount', filters);
  }

  /** sum(unidades_totales) / count(canastas). */
  getUnitsPerTransaction(filters: AnalyticsFilterDto): Promise<number> {
    return this.averageOf('unitsTotal', filters);
  }

  /**
   * Compras (canastas) por mes en el ámbito de los filtros: una zona,
   * una tienda, un segmento o todo.
   *
   * El catálogo `indicadores` la define por cliente (count / clientes
   * distintos / meses), pero `transacciones.cliente_id` no se captura y
   * RN-02 pide analizar por zona agregada, no por persona. Por eso se
   * calcula agregada: canastas / meses del periodo.
   *
   * Periodo: el rango dateFrom–dateTo si viene; el extremo que falte se
   * completa con los meses calendario completos que cubren los datos.
   * Usar solo del primer al último dato extrapolaría unos pocos días a un
   * mes y inflaría el resultado.
   */
  async getPurchaseFrequency(filters: AnalyticsFilterDto): Promise<number> {
    const row = await this.filteredBaskets(filters)
      .select('COUNT(*)', 'baskets')
      // Como texto, no como DATE: el driver convertiría DATE a Date en la
      // zona horaria del proceso y podría recorrer el día.
      .addSelect(`to_char(date_trunc('month', MIN(basket.date)), 'YYYY-MM-DD')`, 'dataStart')
      .addSelect(`to_char(date_trunc('month', MAX(basket.date)) + interval '1 month', 'YYYY-MM-DD')`, 'dataEnd')
      .getRawOne<{ baskets: string; dataStart: string | null; dataEnd: string | null }>();

    const baskets = Number(row?.baskets ?? 0);
    if (baskets === 0 || !row?.dataStart || !row?.dataEnd) return 0;

    const start = parseDay(filters.dateFrom ?? row.dataStart);
    // dateTo es inclusivo; el periodo se maneja con fin exclusivo.
    const end = filters.dateTo ? addDays(parseDay(filters.dateTo), 1) : parseDay(row.dataEnd);

    const months = monthsBetween(start, end);
    if (months <= 0) return 0;
    return round2(baskets / months);
  }

  /**
   * Gasto por categoría de producto, de mayor a menor. La canasta no
   * guarda categorías: se baja a sus líneas de venta, que apuntan a la
   * PRESENTACIÓN, y de ahí se sube a producto y categoría.
   *
   * Agrupa por la categoría directa del producto (no suma hacia
   * `categoria_padre_id`). Las categorías sin ventas no aparecen.
   */
  async getSpendByCategory(filters: AnalyticsFilterDto): Promise<CategorySpend[]> {
    const rows = await this.filteredBaskets(filters)
      // Join por columna y no por `basket.transaction`: filteredBaskets ya
      // usa ese alias cuando filtra por tienda.
      .innerJoin(TransactionDetail, 'detail', 'detail.transactionId = basket.transactionId')
      .innerJoin('detail.presentation', 'presentation')
      .innerJoin('presentation.producto', 'product')
      .innerJoin('product.categoria', 'category')
      .select('category.id', 'categoryId')
      .addSelect('category.nombre', 'categoryName')
      .addSelect('SUM(detail.subtotal)', 'totalSpend')
      .addSelect('SUM(detail.quantity)', 'units')
      .addSelect('COUNT(DISTINCT basket.id)', 'basketCount')
      // Ventana sobre el resultado agrupado: el total sale en la misma
      // consulta. NULLIF evita dividir entre cero si todo suma 0.
      .addSelect('SUM(detail.subtotal) * 100 / NULLIF(SUM(SUM(detail.subtotal)) OVER (), 0)', 'share')
      .groupBy('category.id')
      .addGroupBy('category.nombre')
      .orderBy('SUM(detail.subtotal)', 'DESC')
      .addOrderBy('category.nombre', 'ASC')
      .getRawMany<{
        categoryId: number;
        categoryName: string;
        totalSpend: string;
        units: string;
        basketCount: string;
        share: string | null;
      }>();

    // Postgres devuelve NUMERIC y COUNT como texto.
    return rows.map((row) => ({
      categoryId: Number(row.categoryId),
      categoryName: row.categoryName,
      totalSpend: round2(Number(row.totalSpend)),
      units: round2(Number(row.units)),
      basketCount: Number(row.basketCount),
      share: round2(Number(row.share ?? 0)),
    }));
  }

  /**
   * Consulta base sobre canastas con los filtros aplicados. Todos los
   * indicadores parten de aquí para que filtren exactamente igual.
   */
  private filteredBaskets(filters: AnalyticsFilterDto): SelectQueryBuilder<Basket> {
    const qb = this.basketsRepo.createQueryBuilder('basket');

    if (filters.zoneId) qb.andWhere('basket.zoneId = :zoneId', { zoneId: filters.zoneId });
    if (filters.segmentId) qb.andWhere('basket.segmentId = :segmentId', { segmentId: filters.segmentId });
    if (filters.dateFrom) qb.andWhere('basket.date >= :dateFrom', { dateFrom: filters.dateFrom });
    // `fecha` es timestamptz: comparar contra '2026-09-30' a secas dejaría
    // fuera todo lo vendido ese día después de medianoche. Se toma el día
    // completo.
    if (filters.dateTo) qb.andWhere('basket.date < CAST(:dateTo AS date) + 1', { dateTo: filters.dateTo });
    // La tienda no está en `canastas`: se llega por su transacción.
    if (filters.storeId) {
      qb.innerJoin('basket.transaction', 'transaction').andWhere('transaction.storeId = :storeId', {
        storeId: filters.storeId,
      });
    }

    return qb;
  }

  /** Promedio de una columna numérica de la canasta; 0 si no hay canastas. */
  private async averageOf(
    property: 'totalValue' | 'productCount' | 'unitsTotal',
    filters: AnalyticsFilterDto,
  ): Promise<number> {
    const row = await this.filteredBaskets(filters)
      .select(`AVG(basket.${property})`, 'value')
      .getRawOne<{ value: string | null }>();
    return round2(Number(row?.value ?? 0));
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Duración promedio de un mes (365.25 / 12), para periodos que no son meses completos. */
const AVERAGE_MONTH_DAYS = 30.4375;

/** 'YYYY-MM-DD' (o un ISO completo) → medianoche UTC de ese día. */
function parseDay(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Meses entre `start` (inclusivo) y `end` (exclusivo). Si ambos caen en
 * día 1, cuenta meses calendario exactos (agosto completo = 1, aunque
 * tenga 31 días); si no, divide los días entre el mes promedio.
 */
function monthsBetween(start: Date, end: Date): number {
  if (start.getUTCDate() === 1 && end.getUTCDate() === 1) {
    return (
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth())
    );
  }
  return (end.getTime() - start.getTime()) / DAY_MS / AVERAGE_MONTH_DAYS;
}
