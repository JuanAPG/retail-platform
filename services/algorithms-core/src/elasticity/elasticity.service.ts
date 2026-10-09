import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
import { LIMITE_DEFAULT, LIMITE_MAXIMO, PAGINA_DEFAULT, Pagina } from '../common/dto/pagination.dto';
import { AnalysisRun } from '../entities/analysis-run.entity';
import { AnalysisRunParameter } from '../entities/analysis-run-parameter.entity';
import { AnalysisRunAssumption } from '../entities/analysis-run-assumption.entity';
import { Elasticity } from '../entities/elasticity.entity';
import { FuenteDatos } from '../fuente-datos/fuente-datos.service';
import { CurrentElasticity, CurrentElasticityFilterDto } from './dto/current-elasticity.dto';
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

// El agrupamiento por día o semana ISO (PERIOD_SQL del monolito) vive en
// FuenteDatos.ventasParaElasticidad: es una lectura de ventas de core-process.

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
    /** Ventas, presentaciones, zonas y segmentos: datos de otros servicios. */
    private readonly fuente: FuenteDatos,
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
  async calculate(params: ElasticityParamsDto, user: SesionUsuario): Promise<ElasticityResult> {
    const granularity = params.granularity ?? 'day';
    if (params.dateFrom && params.dateTo && params.dateTo.slice(0, 10) < params.dateFrom.slice(0, 10)) {
      throw new BadRequestException('La fecha final no puede ser anterior a la inicial.');
    }
    if (params.presentationId && (await this.fuente.nombresDePresentaciones([params.presentationId])).size === 0) {
      throw new NotFoundException(`No existe la presentación ${params.presentationId}.`);
    }

    const { rows, baskets, firstDay, lastDay } = await this.fuente.ventasParaElasticidad(params, granularity);
    if (rows.length === 0) {
      throw new BadRequestException('No hay ventas para los filtros indicados.');
    }
    const period: Period = {
      // Con ventas siempre hay primer y último día.
      start: params.dateFrom?.slice(0, 10) ?? firstDay!,
      end: params.dateTo?.slice(0, 10) ?? lastDay!,
    };
    const assumptions = ASSUMPTIONS(granularity);

    try {
      const [names, zones] = await Promise.all([
        this.fuente.nombresDePresentaciones([...new Set(rows.map((r) => r.presentationId))]),
        this.fuente
          .zonas([...new Set(rows.map((r) => r.zoneId))])
          .then((lista) => new Map(lista.map((z) => [z.id, z.nombre]))),
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
    const name = (await this.fuente.nombresDePresentaciones([filters.presentationId])).get(filters.presentationId);
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
    const zones = await this.fuente.zonas(zoneRows.map((r) => r.zoneId!));
    const zoneValues: ZoneElasticity[] = zoneRows.map((r) => ({
      zoneId: r.zoneId!,
      zoneName: zones.find((z) => z.id === r.zoneId)?.nombre ?? r.zoneId!,
      value: Number(r.value),
      rSquared: r.rSquared === null ? null : Number(r.rSquared),
      observations: Number(r.observations),
    }));

    let bars: ElasticityChartBar[];
    let note: string;
    const basis = `análisis del ${run.executedOn}, observaciones por ${run.granularity === 'week' ? 'semana' : 'día'}`;
    if (groupBy === 'zone') {
      bars = zones.map((z) => {
        const found = zoneValues.find((v) => v.zoneId === z.id);
        return { key: z.id, label: z.nombre, ...(found ? this.chartValue(found) : EMPTY_VALUE) };
      });
      note = `Elasticidad de cada zona (${basis}). Barras vacías: sin datos suficientes.`;
    } else {
      const segments = await this.fuente.segmentos();
      // Una sola fuente de verdad para zona → segmento (la de M07), en una consulta.
      const segmentOf = await this.fuente.segmentosDeZonas(zones.map((z) => z.id));
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
   * Elasticidad vigente (nuevo en microservicios; sustituye las consultas
   * que simulación y recomendaciones hacían directo a `elasticidades`):
   * por cada presentación × zona, el valor de la corrida completada MÁS
   * RECIENTE que lo calculó — el mismo criterio que usaban.
   *
   * Con `zoneId` también salen las filas nacionales (zona null): simulación
   * cae a la nacional cuando la zona no tiene valor. Orden: producto,
   * presentación y zona, con la nacional al final de cada presentación,
   * así la primera fila de una presentación es "la de la zona, si no la
   * nacional". Son pocas filas (presentaciones × zonas+1): se pagina en memoria.
   */
  async current(filtros: CurrentElasticityFilterDto): Promise<Pagina<CurrentElasticity>> {
    const rows: {
      presentationId: string;
      zoneId: string | null;
      value: string;
      rSquared: string | null;
      observations: number;
      runId: string;
      executedAt: Date;
    }[] = await this.dataSource.query(
      `SELECT DISTINCT ON (e.presentacion_id, e.zona_id)
              e.presentacion_id AS "presentationId", e.zona_id AS "zoneId", e.valor AS "value",
              e.r_cuadrada AS "rSquared", e.observaciones AS "observations",
              c.id AS "runId", c.ejecutada_en AS "executedAt"
       FROM elasticidades e
       JOIN analisis_corridas c ON c.id = e.corrida_id
       WHERE c.tipo = 'elasticidad' AND c.estado = 'completada'
         AND ($1::uuid IS NULL OR e.presentacion_id = $1::uuid)
         AND ($2::uuid IS NULL OR e.zona_id = $2::uuid OR e.zona_id IS NULL)
       ORDER BY e.presentacion_id, e.zona_id, c.ejecutada_en DESC`,
      [filtros.presentationId ?? null, filtros.zoneId ?? null],
    );

    const zoneIds = rows.flatMap((r) => (r.zoneId ? [r.zoneId] : []));
    const [names, zones] = await Promise.all([
      this.fuente.nombresDePresentaciones(rows.map((r) => r.presentationId)),
      this.fuente.zonas(zoneIds).then((lista) => new Map(lista.map((z) => [z.id, z.nombre]))),
    ]);

    const todas: CurrentElasticity[] = rows.map((r) => {
      const value = Number(r.value);
      const name = names.get(r.presentationId);
      return {
        presentationId: r.presentationId,
        productName: name?.product ?? '',
        presentationName: name?.presentation ?? '',
        zoneId: r.zoneId,
        zoneName: r.zoneId ? (zones.get(r.zoneId) ?? r.zoneId) : NATIONAL,
        value,
        classification: this.classify(value),
        rSquared: r.rSquared === null ? null : Number(r.rSquared),
        observations: Number(r.observations),
        runId: r.runId,
        executedAt: r.executedAt.toISOString(),
      };
    });
    todas.sort(
      (a, b) =>
        a.productName.localeCompare(b.productName, 'es') ||
        a.presentationName.localeCompare(b.presentationName, 'es') ||
        a.presentationId.localeCompare(b.presentationId) ||
        // La nacional al final de cada presentación.
        Number(a.zoneId === null) - Number(b.zoneId === null) ||
        a.zoneName.localeCompare(b.zoneName, 'es'),
    );

    const page = filtros.page ?? PAGINA_DEFAULT;
    const limit = Math.min(filtros.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO);
    return { data: todas.slice((page - 1) * limit, page * limit), total: todas.length, page, limit };
  }

  /**
   * Corrida + parámetros + supuestos + elasticidades en UNA transacción:
   * si algo falla no queda una corrida "completada" a medias. No reutiliza
   * AssociationService.saveRun porque aquel inserta reglas de asociación.
   */
  private async saveElasticityRun(run: {
    user: SesionUsuario;
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
    user: SesionUsuario,
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
