import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsFilterDto } from '../analytics/dto/analytics-filter.dto';
import { CategorySpend } from '../analytics/dto/category-spend.dto';

/** Fila de `v_dashboard_kpis_generales` con números ya convertidos. */
export interface KpisGenerales {
  transaccionesAnalizadas: number;
  canastasConstruidas: number;
  ticketPromedio: number;
  productosPorCanasta: number;
  unidadesPorTransaccion: number;
  zonasAnalizadas: number;
  productosBasicosDisponibles: number;
}

/** Bloque de comportamiento: frecuencia + gasto por categoría. */
export interface Comportamiento {
  frecuenciaCompra: number;
  ticketPromedio: number;
  productosPorCanasta: number;
  unidadesPorTransaccion: number;
  gastoPorCategoria: CategorySpend[];
}

/**
 * M16 — Agregación del tablero. Cada método lee una vista del §16 o
 * delega en el servicio dueño del cálculo; este módulo no calcula nada
 * por su cuenta para no duplicar fórmulas (el ticket promedio, por
 * ejemplo, sigue viviendo en M09).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * KPIs generales. Son globales por definición (la vista no lleva
   * filtros): para el corte por zona/segmento están los endpoints de
   * comportamiento, que sí aceptan `AnalyticsFilterDto`.
   */
  async getKpisGenerales(): Promise<KpisGenerales> {
    const [row] = await this.dataSource.query(
      'SELECT * FROM v_dashboard_kpis_generales',
    );
    return {
      transaccionesAnalizadas: Number(row?.transacciones_analizadas ?? 0),
      canastasConstruidas: Number(row?.canastas_construidas ?? 0),
      ticketPromedio: Number(row?.ticket_promedio ?? 0),
      productosPorCanasta: Number(row?.productos_por_canasta ?? 0),
      unidadesPorTransaccion: Number(row?.unidades_por_transaccion ?? 0),
      zonasAnalizadas: Number(row?.zonas_analizadas ?? 0),
      productosBasicosDisponibles: Number(row?.productos_basicos_disponibles ?? 0),
    };
  }

  /**
   * Comportamiento con los mismos filtros de M09 (tienda, zona,
   * segmento, periodo). Delega todo en `AnalyticsService`: la
   * frecuencia agregada por zona y el gasto por categoría ya están
   * probados ahí, aquí solo se agrupan para el tablero.
   */
  async getComportamiento(filters: AnalyticsFilterDto): Promise<Comportamiento> {
    const [frecuenciaCompra, ticketPromedio, productosPorCanasta, unidadesPorTransaccion, gastoPorCategoria] =
      await Promise.all([
        this.analytics.getPurchaseFrequency(filters),
        this.analytics.getAverageTicket(filters),
        this.analytics.getProductsPerBasket(filters),
        this.analytics.getUnitsPerTransaction(filters),
        this.analytics.getSpendByCategory(filters),
      ]);
    return { frecuenciaCompra, ticketPromedio, productosPorCanasta, unidadesPorTransaccion, gastoPorCategoria };
  }
}
