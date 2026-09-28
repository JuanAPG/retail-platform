import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsFilterDto } from '../analytics/dto/analytics-filter.dto';
import { CategorySpend } from '../analytics/dto/category-spend.dto';
import { SubstitutionService } from '../elasticity/substitution.service';
import { SubstitutionPattern } from '../elasticity/dto/substitution-pattern.dto';

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

/** Regla de asociación en texto legible (de `v_dashboard_asociaciones`). */
export interface AsociacionPrincipal {
  reglaId: string;
  corridaId: string;
  soporte: number;
  confianza: number;
  lift: number | null;
  antecedente: string | null;
  consecuente: string | null;
}

/** Resumen de elasticidad por clasificación (de `v_dashboard_elasticidad`). */
export interface ElasticidadResumen {
  clasificacion: string;
  productos: number;
  elasticidadPromedio: number | null;
}

/** Presentación más sensible al precio (de `elasticidades`). */
export interface ProductoSensible {
  presentacionId: string;
  producto: string;
  presentacion: string;
  zonaId: string | null;
  zona: string | null;
  valor: number;
  clasificacion: string;
  observaciones: number;
}

/** Variación entre precios consecutivos (de `v_variacion_precios`). */
export interface VariacionPrecio {
  presentacionId: string;
  tiendaId: string;
  fechaVigenciaDesde: string;
  precioActual: number;
  precioAnterior: number | null;
  variacionPct: number | null;
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
    private readonly substitution: SubstitutionService,
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

  /**
   * Asociaciones principales, ordenadas por `lift`. Sin corridas de
   * Apriori devuelve `[]`, no error: el tablero no se rompe porque el
   * análisis aún no se corrió.
   */
  async getAsociaciones(limit = 10): Promise<AsociacionPrincipal[]> {
    const rows: Array<Record<string, string | null>> = await this.dataSource.query(
      `SELECT regla_id, corrida_id, soporte, confianza, lift, antecedente, consecuente
       FROM v_dashboard_asociaciones
       ORDER BY lift DESC NULLS LAST, confianza DESC
       LIMIT $1`,
      [Math.min(limit, 50)],
    );
    return rows.map((row) => ({
      reglaId: String(row.regla_id),
      corridaId: String(row.corrida_id),
      soporte: Number(row.soporte),
      confianza: Number(row.confianza),
      lift: row.lift == null ? null : Number(row.lift),
      antecedente: row.antecedente ?? null,
      consecuente: row.consecuente ?? null,
    }));
  }

  /**
   * Sustituciones detectadas en una categoría. Delega en M11: se
   * calculan al vuelo y no se guardan, igual que en su endpoint.
   */
  async getSustituciones(categoryId: string): Promise<SubstitutionPattern[]> {
    return this.substitution.detectPatterns(categoryId);
  }

  /**
   * Elasticidad promedio y conteo por clasificación. Solo corridas
   * `completada`: sin cálculos devuelve `[]`.
   */
  async getElasticidad(): Promise<ElasticidadResumen[]> {
    const rows: Array<Record<string, string | null>> = await this.dataSource.query(
      'SELECT clasificacion, productos, elasticidad_promedio FROM v_dashboard_elasticidad',
    );
    return rows.map((row) => ({
      clasificacion: String(row.clasificacion),
      productos: Number(row.productos ?? 0),
      elasticidadPromedio: row.elasticidad_promedio == null ? null : Number(row.elasticidad_promedio),
    }));
  }

  /**
   * Productos más sensibles: las elasticidades con mayor |valor|.
   * La clasificación sale de la columna generada de la base.
   */
  async getSensibles(limit = 10): Promise<ProductoSensible[]> {
    const rows: Array<Record<string, string | null>> = await this.dataSource.query(
      `SELECT e.presentacion_id, p.nombre AS producto, pp.nombre AS presentacion,
              e.zona_id, z.nombre AS zona, e.valor::text AS valor,
              e.clasificacion::text AS clasificacion, e.observaciones
       FROM elasticidades e
       JOIN analisis_corridas c ON c.id = e.corrida_id
       JOIN producto_presentaciones pp ON pp.id = e.presentacion_id
       JOIN productos p ON p.id = pp.producto_id
       LEFT JOIN zonas z ON z.id = e.zona_id
       WHERE c.estado = 'completada'
       ORDER BY abs(e.valor) DESC
       LIMIT $1`,
      [Math.min(limit, 50)],
    );
    return rows.map((row) => ({
      presentacionId: String(row.presentacion_id),
      producto: String(row.producto),
      presentacion: String(row.presentacion),
      zonaId: row.zona_id ?? null,
      zona: row.zona ?? null,
      valor: Number(row.valor),
      clasificacion: String(row.clasificacion),
      observaciones: Number(row.observaciones ?? 0),
    }));
  }

  /**
   * Variación porcentual entre precios consecutivos. Es posible porque
   * el histórico no se sobrescribe (RN-06); el primer precio de cada
   * pareja trae `variacionPct` nulo.
   */
  async getVariacionPrecios(
    presentationId?: string,
    storeId?: string,
    limit = 50,
  ): Promise<VariacionPrecio[]> {
    const condiciones: string[] = [];
    const params: string[] = [];
    if (presentationId) {
      params.push(presentationId);
      condiciones.push(`presentacion_id = $${params.length}`);
    }
    if (storeId) {
      params.push(storeId);
      condiciones.push(`tienda_id = $${params.length}`);
    }
    params.push(String(Math.min(limit, 200)));
    const rows: Array<Record<string, string | null>> = await this.dataSource.query(
      `SELECT presentacion_id, tienda_id, fecha_vigencia_desde::text AS fecha,
              precio_actual, precio_anterior, variacion_pct
       FROM v_variacion_precios
       ${condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : ''}
       ORDER BY fecha_vigencia_desde DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows.map((row) => ({
      presentacionId: String(row.presentacion_id),
      tiendaId: String(row.tienda_id),
      fechaVigenciaDesde: String(row.fecha),
      precioActual: Number(row.precio_actual),
      precioAnterior: row.precio_anterior == null ? null : Number(row.precio_anterior),
      variacionPct: row.variacion_pct == null ? null : Number(row.variacion_pct),
    }));
  }
}
