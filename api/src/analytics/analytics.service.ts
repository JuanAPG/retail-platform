import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Basket } from '../entities/basket.entity';
import { AnalyticsFilterDto } from './dto/analytics-filter.dto';

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
