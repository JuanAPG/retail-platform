import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { UsuarioSolicitante } from '../common/roles';
import { AnalysisRun } from '../entities/analysis-run.entity';
import { AnalysisRunParameter } from '../entities/analysis-run-parameter.entity';
import { AnalysisRunAssumption } from '../entities/analysis-run-assumption.entity';
import { Elasticity } from '../entities/elasticity.entity';
import { ZonesService } from '../zones/zones.service';
import { ElasticityChartBar, ElasticityChartData, ElasticityChartValue } from './dto/elasticity-chart-data.dto';
import { ElasticityFilterDto } from './dto/elasticity-filter.dto';
import { ElasticityParamsDto, Granularity } from './dto/elasticity-params.dto';
import {
  ElasticityClass,
  ElasticityResult,
  ElasticityResultItem,
  InsufficientElasticity,
} from './dto/elasticity-result.dto';
import {
  classifyElasticity,
  ELASTICITY_DECIMALS,
  InsufficientReason,
  logLogRegression,
  MIN_DISTINCT_PRICES,
  MIN_OBSERVATIONS,
  PriceQuantity,
  roundTo,
} from './elasticity.math';

const NATIONAL = 'Nacional';

/**
 * Cómo se agrupa cada observación en el tiempo. Mapa cerrado: nunca se
 * interpola texto del usuario en el SQL.
 */
const PERIOD_SQL: Record<Granularity, string> = {
  day: `to_char(fecha, 'YYYY-MM-DD')`,
  // Semana ISO: empieza en lunes.
  week: `to_char(date_trunc('week', fecha), 'YYYY-MM-DD')`,
};

const ASSUMPTIONS = (granularity: Granularity) => [
  'Modelo de elasticidad constante: cantidad = A · precio^E; E es la pendiente de ln(cantidad) contra ln(precio).',
  `Cada observación es una zona × ${granularity === 'day' ? 'día' : 'semana'}: precio promedio realmente cobrado (ponderado por unidades) y unidades vendidas.`,
  'Los periodos sin ventas no se observan: no se registra la demanda cero.',
  'No se controlan otros factores que mueven la demanda (promociones, temporada, ingreso, precio de otros productos).',
  'Una elasticidad positiva (la demanda sube con el precio) se marca como atípica.',
  'El agregado nacional junta las ventas de todas las zonas por periodo.',
  `Indicador analítico: se exigen al menos ${MIN_OBSERVATIONS} observaciones y ${MIN_DISTINCT_PRICES} precios distintos; con muestras chicas, leer junto con el R² y el número de observaciones.`,
];

/** Corridas graficables: solo de elasticidad y completadas. Quien la use agrega `AND …`. */
const CHART_RUN_SQL = `
  SELECT c.id, c.periodo_inicio::text AS "periodStart", c.periodo_fin::text AS "periodEnd",
         c.ejecutada_en AS "executedAt", to_char(c.ejecutada_en, 'DD/MM/YYYY') AS "executedOn",
         (SELECT p.valor FROM analisis_corrida_parametros p
           WHERE p.corrida_id = c.id AND p.clave = 'granularidad') AS "granularity"
  FROM analisis_corridas c
  WHERE c.tipo = 'elasticidad' AND c.estado = 'completada'`;

/** Barra de una zona o segmento sin datos suficientes. */
const EMPTY_VALUE: ElasticityChartValue = { value: null, classification: null, observations: 0, rSquared: null };

const REASONS: Record<InsufficientReason, (observations: number) => string> = {
  'single-price': () => 'Un solo precio en el periodo: no se puede medir cómo reacciona la demanda al precio.',
  'few-observations': (n) => `Solo ${n} observación(es); se necesitan al menos ${MIN_OBSERVATIONS}.`,
  'invalid-values': () => 'Hay precios o cantidades no positivos.',
};

/** Ventas agregadas de una presentación en una zona y un periodo. */
interface SalesRow {
  presentationId: string;
  zoneId: string;
  period: string;
  quantity: number;
  /** Σ cantidad × precio: permite promediar el precio ponderado por unidades. */
  revenue: number;
}

interface Period {
  start: string;
  end: string;
}

interface Names {
  product: string;
  presentation: string;
}

/** Elasticidad guardada de una zona, lista para graficar o promediar. */
export interface ZoneElasticity {
  zoneId: string;
  zoneName: string;
  value: number;
  rSquared: number | null;
  observations: number;
}

interface ChartRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  executedAt: Date;
  executedOn: string;
  granularity: string | null;
}

/**
 * M11 — Elasticidad precio-demanda, según Contrato de Métodos y
 * Endpoints. Cada cálculo se guarda como corrida (tipo 'elasticidad') con
 * sus parámetros y supuestos, y cuelga de ella una fila de `elasticidades`
 * por cada presentación × zona (o nacional) con datos suficientes.
 */
@Injectable()
export class ElasticityService {
  private readonly logger = new Logger(ElasticityService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly zonesService: ZonesService,
  ) {}

  /** Misma clasificación que la columna generada de la base. */
  classify(value: number): ElasticityClass {
    return classifyElasticity(value);
  }

  /**
   * `user` no está en la firma del contrato, pero la corrida registra
   * quién la ejecutó y solo el controlador conoce el JWT (mismo patrón que
   * AssociationService.runApriori).
   */
  async calculate(params: ElasticityParamsDto, user: UsuarioSolicitante): Promise<ElasticityResult> {
    const granularity = params.granularity ?? 'day';
    if (params.dateFrom && params.dateTo && params.dateTo.slice(0, 10) < params.dateFrom.slice(0, 10)) {
      throw new BadRequestException('La fecha final no puede ser anterior a la inicial.');
    }
    if (params.presentationId && (await this.loadNames([params.presentationId])).size === 0) {
      throw new NotFoundException(`No existe la presentación ${params.presentationId}.`);
    }

    const { rows, baskets, firstDay, lastDay } = await this.loadSales(params, granularity);
    if (rows.length === 0) {
      throw new BadRequestException('No hay ventas para los filtros indicados.');
    }
    const period: Period = {
      start: params.dateFrom?.slice(0, 10) ?? firstDay,
      end: params.dateTo?.slice(0, 10) ?? lastDay,
    };
    const assumptions = ASSUMPTIONS(granularity);

    try {
      const [names, zones] = await Promise.all([
        this.loadNames([...new Set(rows.map((r) => r.presentationId))]),
        this.loadZoneNames(),
      ]);
      const { results, insufficient } = this.estimate(rows, names, zones);

      const runId = await this.saveElasticityRun({
        user,
        period,
        baskets,
        parameters: [
          ...baseParameters(params, granularity),
          ['resultados_calculados', results.length],
          ['combinaciones_insuficientes', insufficient.length],
        ],
        assumptions,
        results,
      });

      return { runId, periodStart: period.start, periodEnd: period.end, granularity, results, insufficient, assumptions };
    } catch (error) {
      await this.recordFailedRun(params, granularity, user, period, error);
      throw new InternalServerErrorException(
        'No se pudo completar el cálculo de elasticidad; quedó registrado como corrida fallida.',
      );
    }
  }

  /**
   * Elasticidad de una presentación comparada entre zonas o segmentos.
   * No calcula nada nuevo: lee lo que guardó una corrida, así el gráfico
   * es reproducible. Todas las zonas o segmentos aparecen como barra,
   * aunque no tengan valor, para que se vea cuáles no tuvieron datos.
   */
  async getComparativeChart(filters: ElasticityFilterDto): Promise<ElasticityChartData> {
    const groupBy = filters.groupBy ?? 'zone';
    const name = (await this.loadNames([filters.presentationId])).get(filters.presentationId);
    if (!name) throw new NotFoundException(`No existe la presentación ${filters.presentationId}.`);

    const run = filters.runId
      ? await this.findChartRun(filters.runId)
      : await this.latestRunWithResults(filters.presentationId, name);

    const rows: { zoneId: string | null; value: string; rSquared: string | null; observations: number }[] =
      await this.dataSource.query(
        `SELECT zona_id AS "zoneId", valor AS "value", r_cuadrada AS "rSquared", observaciones AS "observations"
         FROM elasticidades WHERE corrida_id = $1 AND presentacion_id = $2`,
        [run.id, filters.presentationId],
      );
    const nationalRow = rows.find((r) => r.zoneId === null);
    const zoneRows = rows.filter((r) => r.zoneId !== null);

    // Zonas activas, más cualquier inactiva que sí tenga resultado en la corrida.
    const zones: { id: string; nombre: string }[] = await this.dataSource.query(
      `SELECT id, nombre FROM zonas WHERE activo OR id = ANY($1::uuid[]) ORDER BY nombre`,
      [zoneRows.map((r) => r.zoneId)],
    );
    const zoneValues: ZoneElasticity[] = zoneRows.map((r) => ({
      zoneId: r.zoneId!,
      zoneName: zones.find((z) => z.id === r.zoneId)?.nombre ?? r.zoneId!,
      value: Number(r.value),
      rSquared: r.rSquared === null ? null : Number(r.rSquared),
      observations: Number(r.observations),
    }));

    let bars: ElasticityChartBar[];
    let note: string;
    const basis = `corrida del ${run.executedOn}, observaciones por ${run.granularity === 'week' ? 'semana' : 'día'}`;
    if (groupBy === 'zone') {
      bars = zones.map((z) => {
        const found = zoneValues.find((v) => v.zoneId === z.id);
        return { key: z.id, label: z.nombre, ...(found ? this.chartValue(found) : EMPTY_VALUE) };
      });
      note = `Elasticidad de cada zona (${basis}). Barras vacías: sin datos suficientes.`;
    } else {
      const segments: { id: number; nombre: string }[] = await this.dataSource.query(
        'SELECT id, nombre FROM segmentos_ingreso ORDER BY ingreso_min',
      );
      // Una sola fuente de verdad para zona → segmento: la misma que usa M07.
      const segmentOf = new Map<string, number | null>();
      for (const z of zones) segmentOf.set(z.id, await this.zonesService.findSegmentId(z.id));
      bars = aggregateBySegment(
        segments.map((s) => ({ id: s.id, name: s.nombre })),
        zoneValues,
        segmentOf,
      );
      note =
        `Promedio de las zonas de cada segmento (clasificación vigente), ponderado por observaciones (${basis}). ` +
        'Es una aproximación: no equivale a calcular la elasticidad con todas las ventas del segmento juntas.';
    }

    return {
      runId: run.id,
      presentationId: filters.presentationId,
      productName: name.product,
      presentationName: name.presentation,
      groupBy,
      executedAt: run.executedAt.toISOString(),
      granularity: run.granularity === 'week' ? 'week' : 'day',
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      bars,
      national: nationalRow
        ? this.chartValue({
            value: Number(nationalRow.value),
            rSquared: nationalRow.rSquared === null ? null : Number(nationalRow.rSquared),
            observations: Number(nationalRow.observations),
          })
        : null,
      note,
    };
  }

  private chartValue(v: { value: number; rSquared: number | null; observations: number }): ElasticityChartValue {
    return {
      value: v.value,
      classification: this.classify(v.value),
      observations: v.observations,
      rSquared: v.rSquared,
    };
  }

  /** Solo corridas de elasticidad completadas: no se grafica una de asociación ni una fallida. */
  private async findChartRun(runId: string): Promise<ChartRun> {
    const [run] = await this.dataSource.query(`${CHART_RUN_SQL} AND c.id = $1`, [runId]);
    if (!run) throw new NotFoundException(`No existe una corrida de elasticidad completada con id ${runId}.`);
    return run;
  }

  /**
   * La más reciente CON resultados para la presentación, no la más
   * reciente a secas: una corrida semanal posterior con 0 resultados
   * dejaría el gráfico vacío aunque haya una anterior con datos.
   */
  private async latestRunWithResults(presentationId: string, name: Names): Promise<ChartRun> {
    const [run] = await this.dataSource.query(
      `${CHART_RUN_SQL}
       AND EXISTS (SELECT 1 FROM elasticidades e WHERE e.corrida_id = c.id AND e.presentacion_id = $1)
       ORDER BY c.ejecutada_en DESC LIMIT 1`,
      [presentationId],
    );
    if (!run) {
      throw new NotFoundException(
        `No hay elasticidades calculadas para ${name.product} ${name.presentation}: ` +
          'ninguna corrida tuvo datos suficientes para esta presentación.',
      );
    }
    return run;
  }

  /**
   * Una regresión por presentación a nivel nacional y otra por cada zona
   * con ventas. Lo que no alcanza el mínimo va a `insufficient` con su
   * motivo, en lugar de un número que no significa nada.
   */
  private estimate(
    rows: SalesRow[],
    names: Map<string, Names>,
    zones: Map<string, string>,
  ): { results: ElasticityResultItem[]; insufficient: InsufficientElasticity[] } {
    const byPresentation = new Map<string, SalesRow[]>();
    for (const row of rows) {
      const list = byPresentation.get(row.presentationId) ?? [];
      list.push(row);
      byPresentation.set(row.presentationId, list);
    }

    const results: ElasticityResultItem[] = [];
    const insufficient: InsufficientElasticity[] = [];

    for (const [presentationId, presentationRows] of byPresentation) {
      const name = names.get(presentationId)!;
      const zoneIds = [...new Set(presentationRows.map((r) => r.zoneId))].sort((a, b) =>
        (zones.get(a) ?? a).localeCompare(zones.get(b) ?? b, 'es'),
      );
      const targets: { zoneId: string | null; zoneName: string; rows: SalesRow[] }[] = [
        { zoneId: null, zoneName: NATIONAL, rows: presentationRows },
        ...zoneIds.map((zoneId) => ({
          zoneId,
          zoneName: zones.get(zoneId) ?? zoneId,
          rows: presentationRows.filter((r) => r.zoneId === zoneId),
        })),
      ];

      for (const target of targets) {
        const outcome = logLogRegression(observationsOf(target.rows));
        const base = {
          presentationId,
          productName: name.product,
          presentationName: name.presentation,
          zoneId: target.zoneId,
          zoneName: target.zoneName,
          observations: outcome.observations,
        };
        if (outcome.ok) {
          // El mismo redondeo que se guarda y con el que clasifica la base.
          const value = roundTo(outcome.elasticity, ELASTICITY_DECIMALS);
          results.push({
            ...base,
            value,
            classification: this.classify(value),
            rSquared: outcome.rSquared === null ? null : roundTo(outcome.rSquared, 5),
            atypical: value > 0,
          });
        } else {
          insufficient.push({
            ...base,
            distinctPrices: outcome.distinctPrices,
            reason: REASONS[outcome.reason](outcome.observations),
          });
        }
      }
    }

    const order = (a: { productName: string; presentationName: string }, b: typeof a) =>
      a.productName.localeCompare(b.productName, 'es') || a.presentationName.localeCompare(b.presentationName, 'es');
    results.sort(order);
    insufficient.sort(order);
    return { results, insufficient };
  }

  /**
   * Ventas por presentación × zona × periodo. Zona y fecha salen de la
   * CANASTA (clasificación vigente al momento de la compra), igual que en
   * M09 y M10; el precio, de las líneas de venta, que ya reflejan el
   * histórico de precios de M08.
   */
  private async loadSales(params: ElasticityParamsDto, granularity: Granularity) {
    const lineas = `
      SELECT d.presentacion_id, k.zona_id, k.id AS canasta_id, k.fecha, d.cantidad, d.precio_unitario
      FROM transacciones_detalle d
      JOIN canastas k ON k.transaccion_id = d.transaccion_id
      WHERE ($1::uuid IS NULL OR d.presentacion_id = $1::uuid)
        AND ($2::date IS NULL OR k.fecha >= $2::date)
        -- dateTo inclusivo: abarca el día completo.
        AND ($3::date IS NULL OR k.fecha < $3::date + 1)`;
    const args = [params.presentationId ?? null, params.dateFrom ?? null, params.dateTo ?? null];

    const [rows, [summary]] = await Promise.all([
      this.dataSource.query(
        `WITH lineas AS (${lineas})
         SELECT presentacion_id AS "presentationId", zona_id AS "zoneId",
                ${PERIOD_SQL[granularity]} AS "period",
                SUM(cantidad)::float8 AS "quantity",
                SUM(cantidad * precio_unitario)::float8 AS "revenue"
         FROM lineas
         GROUP BY 1, 2, 3`,
        args,
      ) as Promise<SalesRow[]>,
      this.dataSource.query(
        `WITH lineas AS (${lineas})
         SELECT COUNT(DISTINCT canasta_id)::int AS "baskets",
                to_char(MIN(fecha), 'YYYY-MM-DD') AS "firstDay",
                to_char(MAX(fecha), 'YYYY-MM-DD') AS "lastDay"
         FROM lineas`,
        args,
      ) as Promise<{ baskets: number; firstDay: string; lastDay: string }[]>,
    ]);
    return { rows, ...summary };
  }

  private async loadNames(presentationIds: string[]): Promise<Map<string, Names>> {
    const rows: { id: string; product: string; presentation: string }[] = await this.dataSource.query(
      `SELECT pp.id, p.nombre AS product, pp.nombre AS presentation
       FROM producto_presentaciones pp JOIN productos p ON p.id = pp.producto_id
       WHERE pp.id = ANY($1::uuid[])`,
      [presentationIds],
    );
    return new Map(rows.map((r) => [r.id, { product: r.product, presentation: r.presentation }]));
  }

  private async loadZoneNames(): Promise<Map<string, string>> {
    const rows: { id: string; nombre: string }[] = await this.dataSource.query('SELECT id, nombre FROM zonas');
    return new Map(rows.map((r) => [r.id, r.nombre]));
  }

  /**
   * Corrida + parámetros + supuestos + elasticidades en UNA transacción:
   * si algo falla no queda una corrida "completada" a medias. No reutiliza
   * AssociationService.saveRun porque aquel inserta reglas de asociación.
   */
  private async saveElasticityRun(run: {
    user: UsuarioSolicitante;
    period: Period;
    baskets: number;
    parameters: [string, string | number][];
    assumptions: string[];
    results: ElasticityResultItem[];
  }): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      const saved = await this.saveHeader(manager, {
        status: 'completada',
        userId: run.user.id,
        period: run.period,
        baskets: run.baskets,
        errorMessage: null,
        parameters: run.parameters,
        assumptions: run.assumptions,
      });
      if (run.results.length > 0) {
        await manager.insert(
          Elasticity,
          run.results.map((r) => ({
            runId: saved.id,
            presentationId: r.presentationId,
            zoneId: r.zoneId,
            value: r.value,
            rSquared: r.rSquared,
            observations: r.observations,
          })),
        );
      }
      return saved.id;
    });
  }

  private async saveHeader(
    manager: EntityManager,
    run: {
      status: 'completada' | 'fallida';
      userId: string;
      period: Period;
      baskets: number | null;
      errorMessage: string | null;
      parameters: [string, string | number][];
      assumptions: string[];
    },
  ): Promise<AnalysisRun> {
    const saved = await manager.save(
      manager.create(AnalysisRun, {
        type: 'elasticidad',
        status: run.status,
        userId: run.userId,
        periodStart: run.period.start,
        periodEnd: run.period.end,
        // Una canasta = una transacción (RN-03).
        transactionsConsidered: run.baskets,
        basketsConsidered: run.baskets,
        errorMessage: run.errorMessage,
      }),
    );
    if (run.parameters.length > 0) {
      await manager.insert(
        AnalysisRunParameter,
        run.parameters.map(([key, value]) => ({ runId: saved.id, key, value: String(value) })),
      );
    }
    if (run.assumptions.length > 0) {
      await manager.insert(
        AnalysisRunAssumption,
        run.assumptions.map((assumption, n) => ({ runId: saved.id, order: n + 1, assumption })),
      );
    }
    return saved;
  }

  /**
   * Deja constancia de un intento fallido (chk_corrida_error exige el
   * mensaje). Si esto también falla solo se registra en el log, para no
   * ocultar el error original.
   */
  private async recordFailedRun(
    params: ElasticityParamsDto,
    granularity: Granularity,
    user: UsuarioSolicitante,
    period: Period,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Cálculo de elasticidad fallido: ${message}`, error instanceof Error ? error.stack : undefined);
    try {
      await this.dataSource.transaction((manager) =>
        this.saveHeader(manager, {
          status: 'fallida',
          userId: user.id,
          period,
          baskets: null,
          errorMessage: message,
          parameters: baseParameters(params, granularity),
          assumptions: [],
        }),
      );
    } catch (recordError) {
      this.logger.error(`No se pudo registrar la corrida fallida: ${String(recordError)}`);
    }
  }
}

/**
 * Vista por segmento (RN-02: el segmento es de la zona, no de la persona).
 * Cada segmento vale el promedio de sus zonas con datos, ponderado por
 * observaciones: la zona con más ventas pesa más. El R² queda en null
 * porque promediar R² de regresiones distintas no significa nada.
 */
export function aggregateBySegment(
  segments: { id: number; name: string }[],
  zoneValues: ZoneElasticity[],
  segmentOf: Map<string, number | null>,
): ElasticityChartBar[] {
  return segments.map((segment) => {
    const zones = zoneValues.filter((z) => segmentOf.get(z.zoneId) === segment.id);
    const bar = { key: String(segment.id), label: segment.name };
    if (zones.length === 0) return { ...bar, ...EMPTY_VALUE, zones: [] };

    const observations = zones.reduce((sum, z) => sum + z.observations, 0);
    const value = roundTo(zones.reduce((sum, z) => sum + z.value * z.observations, 0) / observations, ELASTICITY_DECIMALS);
    return {
      ...bar,
      value,
      classification: classifyElasticity(value),
      observations,
      rSquared: null,
      zones: zones.map((z) => z.zoneName).sort((a, b) => a.localeCompare(b, 'es')),
    };
  });
}

/**
 * Parámetros de entrada de la corrida. La presentación va aquí y no como
 * filtro: `dimension_analisis` no admite "presentación", y guardarla como
 * "producto" falsearía el dato.
 */
function baseParameters(params: ElasticityParamsDto, granularity: Granularity): [string, string | number][] {
  return [
    ['metodo', 'regresion_log_log'],
    ['granularidad', granularity],
    ['observaciones_minimas', MIN_OBSERVATIONS],
    ['precios_distintos_minimos', MIN_DISTINCT_PRICES],
    ...(params.presentationId ? [['presentacion_id', params.presentationId] as [string, string]] : []),
  ];
}

/** Suma las zonas de un mismo periodo: precio promedio ponderado por unidades. */
function observationsOf(rows: SalesRow[]): PriceQuantity[] {
  const byPeriod = new Map<string, { quantity: number; revenue: number }>();
  for (const row of rows) {
    const acc = byPeriod.get(row.period) ?? { quantity: 0, revenue: 0 };
    acc.quantity += Number(row.quantity);
    acc.revenue += Number(row.revenue);
    byPeriod.set(row.period, acc);
  }
  return [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { quantity, revenue }]) => ({ price: revenue / quantity, quantity }));
}
