import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Basket } from '../entities/basket.entity';
import { TransactionDetail } from '../entities/transaction-detail.entity';
import { AnalyticsFilterDto } from './dto/analytics-filter.dto';
import { CategorySpend } from './dto/category-spend.dto';
import { WeeklySalesFilterDto } from './dto/weekly-sales-filter.dto';
import { WeeklySales } from './dto/weekly-sales.dto';
import { filtrarDiasLocales, ZONA_HORARIA } from '../common/zona-horaria';

/**
 * M09 — Indicadores descriptivos, según Contrato de Métodos y Endpoints.
 *
 * Se calculan sobre `canastas` (M07) y no sobre `transacciones`: la
 * canasta ya trae valor total, productos y unidades precalculados, y
 * además la zona y el segmento vigentes al momento de construirla.
 * Las fórmulas son las mismas que documenta el catálogo `indicadores`
 * (ver db/data_retail.sql).
 */
/** Etiqueta de las ventas cuyo producto no tiene categoría asignada. */
export const SIN_CATEGORIA = 'Sin categoría';

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
      //
      // `AT TIME ZONE` antes del `date_trunc` porque `basket.date` es
      // timestamptz y el truncado usaría el huso de la SESIÓN (UTC en el
      // compose): la última canasta del 30 de septiembre a las 21:00
      // locales ya es 1 de octubre en UTC, así que el periodo se estiraba
      // un mes y la frecuencia salía a la mitad. El filtro de esta misma
      // consulta ya recorta por día local; esto lo hace coherente.
      .addSelect(
        `to_char(date_trunc('month', MIN(basket.date) AT TIME ZONE :zonaPeriodo), 'YYYY-MM-DD')`,
        'dataStart',
      )
      .addSelect(
        `to_char(date_trunc('month', MAX(basket.date) AT TIME ZONE :zonaPeriodo) + interval '1 month', 'YYYY-MM-DD')`,
        'dataEnd',
      )
      .setParameter('zonaPeriodo', ZONA_HORARIA)
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
   *
   * El join a categoría es LEFT, no INNER: con INNER, un producto sin
   * categoría desaparecería del resultado y los `share` seguirían sumando
   * 100 % sobre un total incompleto, es decir, el gasto se perdería SIN
   * que nada lo delatara. Hoy `productos.categoria_id` es NOT NULL y el
   * caso es inalcanzable, pero el error sería invisible si eso cambia, así
   * que esas ventas se agrupan como "Sin categoría" (`categoryId: null`).
   */
  async getSpendByCategory(filters: AnalyticsFilterDto): Promise<CategorySpend[]> {
    const rows = await this.filteredBaskets(filters)
      // Join por columna y no por `basket.transaction`: filteredBaskets ya
      // usa ese alias cuando filtra por tienda.
      .innerJoin(TransactionDetail, 'detail', 'detail.transactionId = basket.transactionId')
      .innerJoin('detail.presentation', 'presentation')
      .innerJoin('presentation.producto', 'product')
      .leftJoin('product.categoria', 'category')
      .select('category.id', 'categoryId')
      .addSelect(`COALESCE(category.nombre, '${SIN_CATEGORIA}')`, 'categoryName')
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
        categoryId: number | null;
        categoryName: string;
        totalSpend: string;
        units: string;
        basketCount: string;
        share: string | null;
      }>();

    // Postgres devuelve NUMERIC y COUNT como texto.
    return rows.map((row) => ({
      // `null` cuando el producto no tiene categoría: no se fuerza a 0,
      // que sería un id de categoría inexistente.
      categoryId: row.categoryId == null ? null : Number(row.categoryId),
      categoryName: row.categoryName,
      totalSpend: round2(Number(row.totalSpend)),
      units: round2(Number(row.units)),
      basketCount: Number(row.basketCount),
      share: round2(Number(row.share ?? 0)),
    }));
  }

  /**
   * Ventas de UN producto por semana y presentación (T-13, consumidor:
   * demand-forecast-service). Ruta nueva del Sprint 4.
   *
   * - Parte de `filteredBaskets`, así que la zona es la congelada en la
   *   canasta y los días son locales, igual que los 5 indicadores.
   * - La semana es la de `date_trunc('week', …)` (lunes) sobre la fecha en
   *   hora de Monterrey, por el mismo motivo que la frecuencia de compra: en
   *   UTC una venta del domingo a las 21:00 caería en la semana siguiente.
   * - No se mezclan presentaciones (D-06): una fila por semana y
   *   presentación; la conversión a kg/l/pza la hace el consumidor.
   * - `asOf` fija la instantánea (`construida_en ≤ asOf`): repetir con el
   *   mismo `asOf` da lo mismo aunque después entren ventas.
   * - `transactions` y `stores` del encabezado son DISTINTOS en toda la
   *   ventana (cobertura de D-36): no se pueden sumar desde las filas, por
   *   eso salen de su propia consulta.
   */
  async getWeeklySales(filters: WeeklySalesFilterDto): Promise<WeeklySales> {
    validarRangoDeDias(filters);
    const asOf = filters.asOf ? new Date(filters.asOf) : new Date();

    const lineasDelProducto = () =>
      this.filteredBaskets({ zoneId: filters.zoneId, dateFrom: filters.dateFrom, dateTo: filters.dateTo })
        .innerJoin(TransactionDetail, 'detail', 'detail.transactionId = basket.transactionId')
        .innerJoin('detail.presentation', 'presentation')
        .andWhere('presentation.productoId = :productId', { productId: filters.productId })
        .andWhere('basket.builtAt <= :asOf', { asOf });

    const semana = `date_trunc('week', basket.date AT TIME ZONE :zonaSemana)`;
    const filas = await lineasDelProducto()
      .select(`to_char(${semana}, 'YYYY-MM-DD')`, 'weekStart')
      .addSelect('detail.presentationId', 'presentationId')
      .addSelect('SUM(detail.quantity)', 'quantity')
      .addSelect('COUNT(DISTINCT basket.id)', 'transactions')
      .setParameter('zonaSemana', ZONA_HORARIA)
      .groupBy(semana)
      .addGroupBy('detail.presentationId')
      .orderBy(semana, 'ASC')
      .addOrderBy('detail.presentationId', 'ASC')
      .getRawMany<{ weekStart: string; presentationId: string; quantity: string; transactions: string }>();

    const cobertura = await lineasDelProducto()
      // Alias propio: `transaction` lo usa filteredBaskets con storeId.
      .innerJoin('basket.transaction', 'venta')
      .select('COUNT(DISTINCT basket.id)', 'transactions')
      .addSelect('COUNT(DISTINCT venta.storeId)', 'stores')
      .getRawOne<{ transactions: string; stores: string }>();

    // Mismo orden de campos que el XSD (xs:sequence); los nulos se omiten en XML.
    return {
      productId: filters.productId,
      zoneId: filters.zoneId ?? null,
      dateFrom: filters.dateFrom?.slice(0, 10) ?? null,
      dateTo: filters.dateTo?.slice(0, 10) ?? null,
      timezone: ZONA_HORARIA,
      weekStartsOn: 'monday',
      asOf: asOf.toISOString(),
      transactions: Number(cobertura?.transactions ?? 0),
      stores: Number(cobertura?.stores ?? 0),
      data: filas.map((fila) => ({
        weekStart: fila.weekStart,
        presentationId: fila.presentationId,
        quantity: round2(Number(fila.quantity)),
        transactions: Number(fila.transactions),
      })),
    };
  }

  /**
   * Consulta base sobre canastas con los filtros aplicados. Todos los
   * indicadores parten de aquí para que filtren exactamente igual.
   */
  private filteredBaskets(filters: AnalyticsFilterDto): SelectQueryBuilder<Basket> {
    const qb = this.basketsRepo.createQueryBuilder('basket');

    if (filters.zoneId) qb.andWhere('basket.zoneId = :zoneId', { zoneId: filters.zoneId });
    if (filters.segmentId) qb.andWhere('basket.segmentId = :segmentId', { segmentId: filters.segmentId });
    // Días completos locales en los dos extremos (ver filtrarDiasLocales):
    // `fecha` es timestamptz y la frontera del día es la de Monterrey.
    filtrarDiasLocales(qb, 'basket.date', filters);
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

/**
 * Las lecturas nuevas del Sprint 4 rechazan un rango invertido con 400. Los
 * 5 indicadores anteriores lo dejan pasar (un rango invertido da 0) y no se
 * cambian aquí para no alterar a sus consumidores.
 */
function validarRangoDeDias(filtros: { dateFrom?: string; dateTo?: string }): void {
  if (filtros.dateFrom && filtros.dateTo && filtros.dateFrom.slice(0, 10) > filtros.dateTo.slice(0, 10)) {
    throw new BadRequestException('dateFrom no puede ser posterior a dateTo.');
  }
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
