import { createHash, randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
import { ContextoPeticion, ReporteDeCorridas } from '../common/reportes/reporte-de-corridas.service';
import { Pagina, PaginationDto } from '../common/dto/pagination.dto';
import { paginar } from '../common/helpers/pagination.helper';
import { diaDelFiltro } from '../common/validators/filtro-de-fecha';
import { AssociationExclusion } from '../entities/association-exclusion.entity';
import { FuenteDatos, ResumenProducto } from '../fuente-datos/fuente-datos.service';
import { apriori, AprioriRule, compareItems } from './apriori';
import {
  CorridaAsociacionMongo,
  DimensionFiltro,
  FiltroCorrida,
  FotoDatos,
  ItemRegla,
  LadoRegla,
  ParametroCorrida,
  ReglaGuardada,
} from './corrida-asociacion.schema';
import { CorridasAsociacion, NuevaCorrida } from './corridas-asociacion.repository';
import { AprioriParamsDto } from './dto/apriori-params.dto';
import { fpGrowth } from './fpgrowth';

/**
 * Los dos algoritmos de M10 (D2): mismas entradas y la misma forma de
 * resultado. La llave es el valor del parámetro `algoritmo` de la corrida.
 */
const ALGORITMOS = {
  apriori: { nombre: 'Apriori', correr: apriori },
  fpgrowth: { nombre: 'FP-Growth', correr: fpGrowth },
};
export type Algoritmo = keyof typeof ALGORITMOS;

const DEFAULT_MAX_ITEMSET_SIZE = 3;

/** Un producto presente en una canasta, con lo necesario para Apriori y RN-10. */
interface BasketLine {
  basketId: string;
  productId: string;
  categoryId: number;
  /** Día de la canasta, 'yyyy-mm-dd'. */
  day: string;
}

interface Period {
  start: string;
  end: string;
}

/** Ítem de una regla como lo pide el contrato: con el resumen de su producto. */
export interface ItemConProducto {
  ruleId: string;
  productId: string;
  side: LadoRegla;
  product: ResumenProducto | null;
}

/** Regla como la pide el contrato. */
export interface ReglaConProductos {
  id: string;
  runId: string;
  support: number;
  confidence: number;
  lift: number | null;
  transactionCount: number | null;
  items: ItemConProducto[];
}

/**
 * Corrida como la pide el contrato: `date` en texto ISO (un `Date` sale
 * vacío en XML), `user` como `{ id, nombre }` y cada parámetro, supuesto y
 * filtro con su `runId`. Supuestos, filtros y reglas solo en el detalle.
 */
export interface CorridaRespuesta {
  id: string;
  type: 'asociacion';
  status: CorridaAsociacionMongo['status'];
  userId: string | null;
  periodStart: string;
  periodEnd: string;
  transactionsConsidered: number | null;
  basketsConsidered: number | null;
  errorMessage: string | null;
  parameters: { runId: string; key: string; value: string }[];
  assumptions?: { runId: string; order: number; assumption: string }[];
  filters?: { runId: string; dimension: DimensionFiltro; referenceId: string }[];
  date: string;
  user: { id: string; nombre: string } | null;
  results?: ReglaConProductos[];
}

/**
 * M10 — Reglas de asociación (Apriori y FP-Growth), según Contrato de
 * Métodos y Endpoints. Cada corrida se guarda completa en MongoDB (D3):
 * parámetros, supuestos, filtros, periodo, usuario, reglas y la foto de los
 * datos (D-15), para poder reproducirla (RF-15).
 */
@Injectable()
export class AssociationService {
  private readonly logger = new Logger(AssociationService.name);

  constructor(
    private readonly corridas: CorridasAsociacion,
    /** RN-10: los pares de categorías excluidos siguen en Postgres (tabla de este servicio). */
    @InjectRepository(AssociationExclusion)
    private readonly exclusionsRepo: Repository<AssociationExclusion>,
    /** Canastas, productos y usuarios: datos de otros servicios. */
    private readonly fuente: FuenteDatos,
    /** Bitácora y aviso de cada corrida (ALG-10). */
    private readonly reporte: ReporteDeCorridas,
  ) {}

  /** Corre Apriori y guarda la corrida (ver `run`). */
  runApriori(params: AprioriParamsDto, user: SesionUsuario, contexto: ContextoPeticion = {}): Promise<ReglaConProductos[]> {
    return this.run('apriori', params, user, contexto);
  }

  /**
   * Corre FP-Growth y guarda la corrida (ver `run`). Con los mismos datos
   * y umbrales da las mismas reglas que Apriori, en el mismo orden (RF-14).
   */
  runFpGrowth(params: AprioriParamsDto, user: SesionUsuario, contexto: ContextoPeticion = {}): Promise<ReglaConProductos[]> {
    return this.run('fpgrowth', params, user, contexto);
  }

  /**
   * Corre el algoritmo sobre las canastas filtradas y guarda la corrida.
   * `user` no está en la firma del contrato, pero la corrida debe registrar
   * quién la ejecutó y solo el controlador conoce el JWT (mismo patrón que
   * TransactionsService.createManual).
   *
   * Errores de entrada (fechas invertidas, sin canastas) responden 400 y
   * no generan corrida. Sin MongoDB responde 503 antes de leer los datos
   * (D-25): una corrida que no se puede guardar no se puede reproducir.
   * Una falla después de leer los datos deja la corrida registrada como
   * `fallida`.
   */
  private async run(
    algoritmo: Algoritmo,
    params: AprioriParamsDto,
    user: SesionUsuario,
    contexto: ContextoPeticion,
  ): Promise<ReglaConProductos[]> {
    const { nombre, correr } = ALGORITMOS[algoritmo];
    // EsFiltroDeFecha garantiza que los primeros 10 caracteres son un día real:
    // comparar ese texto es comparar las fechas.
    if (params.dateFrom && params.dateTo && diaDelFiltro(params.dateTo) < diaDelFiltro(params.dateFrom)) {
      throw new BadRequestException('La fecha final no puede ser anterior a la inicial.');
    }
    this.corridas.exigirMongo();

    const lines = await this.fuente.lineasDeCanasta(params);
    if (lines.length === 0) {
      throw new BadRequestException('No hay canastas para los filtros indicados.');
    }

    const period = this.periodOf(params, lines);
    const maxItemsetSize = params.maxItemsetSize ?? DEFAULT_MAX_ITEMSET_SIZE;
    const corrida = { tipo: 'asociacion' as const, nombre, periodo: period };

    let guardada: CorridaAsociacionMongo;
    let resumen: string;
    try {
      const { baskets, categoryOf } = groupByBasket(lines);
      const { rules } = correr(baskets, {
        minSupport: params.minSupport,
        minConfidence: params.minConfidence,
        maxItemsetSize,
      });

      const excludedPairs = await this.loadExcludedCategoryPairs();
      const kept = rules.filter((rule) => !isExcluded(rule, categoryOf, excludedPairs));

      guardada = await this.corridas.guardar(
        this.buildRun(algoritmo, params, user, period, baskets, maxItemsetSize, {
          generated: rules.length,
          excluded: rules.length - kept.length,
          rules: kept,
        }),
      );
      resumen =
        `${kept.length} regla(s) con soporte ≥ ${params.minSupport} y confianza ≥ ${params.minConfidence}, ` +
        `sobre ${baskets.length} canasta(s).`;
    } catch (error) {
      // Mongo se cayó a media corrida: no hay dónde registrarla como fallida.
      const sinMongo = error instanceof ServiceUnavailableException;
      const fallidaId = sinMongo ? null : await this.recordFailedRun(algoritmo, params, user, period, maxItemsetSize, error);
      await this.reporte.terminada(
        {
          ...corrida,
          runId: fallidaId,
          estado: 'fallida',
          resumen: sinMongo
            ? 'No se pudo guardar la corrida: MongoDB no está disponible.'
            : 'No se pudo completar la corrida; quedó registrada como fallida.',
        },
        user.id,
        contexto,
      );
      if (sinMongo) throw error;
      throw new InternalServerErrorException(
        `No se pudo completar la corrida de ${nombre}; quedó registrada como fallida.`,
      );
    }

    // Fuera del try: el reporte nunca lanza, pero si lo hiciera no debe
    // convertir una corrida ya guardada en "fallida".
    await this.reporte.terminada({ ...corrida, runId: guardada._id, estado: 'completada', resumen }, user.id, contexto);
    return this.reglasConProductos(guardada._id, guardada.results);
  }

  /**
   * Historial de corridas de asociación, de la más reciente a la más
   * antigua, con sus parámetros. Sin reglas: pueden ser cientos por
   * corrida y se piden con findRun. Las fallidas también aparecen.
   * Paginado según docs/contratos/paginacion.md.
   */
  async findAllRuns(paginacion: PaginationDto): Promise<Pagina<CorridaRespuesta>> {
    const pagina = await paginar(this.corridas.historial(), paginacion);
    return { ...pagina, data: await this.paraRespuesta(pagina.data) };
  }

  /**
   * Una corrida de asociación completa: parámetros, supuestos en orden,
   * filtros y reglas con sus productos. Lo necesario para reproducirla y
   * explicarla.
   */
  async findRun(id: string): Promise<CorridaRespuesta> {
    const run = await this.corridas.porId(id);
    if (!run) throw new NotFoundException(`No existe la corrida de asociación ${id}.`);

    const [corrida] = await this.paraRespuesta([run]);
    return {
      ...corrida,
      assumptions: run.assumptions.map((assumption, n) => ({ runId: run._id, order: n + 1, assumption })),
      filters: [...run.filters]
        .sort((a, b) => a.dimension.localeCompare(b.dimension))
        .map((f) => ({ runId: run._id, dimension: f.dimension, referenceId: f.referenceId })),
      results: await this.reglasConProductos(run._id, run.results),
    };
  }

  /**
   * Lo que el contrato pide de cada corrida: `id` (el `_id` de Mongo),
   * `date` en texto ISO, `user` como `{ id, nombre }` (solo eso: nunca otros
   * datos del usuario) y los parámetros ordenados por clave.
   */
  private async paraRespuesta(runs: CorridaAsociacionMongo[]): Promise<CorridaRespuesta[]> {
    const nombres = await this.fuente.nombresDeUsuarios(runs.flatMap((r) => (r.userId ? [r.userId] : [])));
    return runs.map((run) => {
      const nombre = run.userId ? nombres.get(run.userId) : undefined;
      return {
        id: run._id,
        type: 'asociacion',
        status: run.status,
        userId: run.userId,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        transactionsConsidered: run.transactionsConsidered,
        basketsConsidered: run.basketsConsidered,
        errorMessage: run.errorMessage,
        parameters: [...run.parameters]
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((p) => ({ runId: run._id, key: p.key, value: p.value })),
        date: new Date(run.date).toISOString(),
        user: run.userId && nombre !== undefined ? { id: run.userId, nombre } : null,
      };
    });
  }

  /** Pares de categorías excluidos (RN-10), como 'menor-mayor'. */
  private async loadExcludedCategoryPairs(): Promise<Set<string>> {
    const exclusions = await this.exclusionsRepo.find({ where: { active: true } });
    return new Set(exclusions.map((e) => pairKey(e.categoryAId, e.categoryBId)));
  }

  /** El periodo pedido; lo que falte se completa con las fechas de los datos. */
  private periodOf(params: AprioriParamsDto, lines: BasketLine[]): Period {
    const days = lines.map((l) => l.day).sort();
    return {
      start: diaDelFiltro(params.dateFrom) ?? days[0],
      end: diaDelFiltro(params.dateTo) ?? days[days.length - 1],
    };
  }

  private buildRun(
    algoritmo: Algoritmo,
    params: AprioriParamsDto,
    user: SesionUsuario,
    period: Period,
    baskets: string[][],
    maxItemsetSize: number,
    outcome: { generated: number; excluded: number; rules: AprioriRule[] },
  ): NuevaCorrida {
    const assumptions = [
      'Una canasta equivale a una transacción (RN-03).',
      'Las presentaciones se agrupan en su producto y la cantidad comprada no pondera: cuenta presencia o ausencia.',
      `Se aplicaron las exclusiones de categorías vigentes (RN-10): ${outcome.excluded} regla(s) descartada(s).`,
    ];
    if (params.segmentId) {
      assumptions.push('El segmento de ingreso es el de la zona de la compra, no el de la persona (RN-02).');
    }

    return {
      status: 'completada',
      userId: user.id,
      periodStart: period.start,
      periodEnd: period.end,
      // Una canasta = una transacción (RN-03).
      transactionsConsidered: baskets.length,
      basketsConsidered: baskets.length,
      errorMessage: null,
      parameters: [
        ...algorithmParameters(algoritmo, params, maxItemsetSize),
        param('reglas_generadas', outcome.generated),
        param('reglas_excluidas_rn10', outcome.excluded),
      ],
      assumptions,
      filters: [
        ...(params.storeId ? [filter('tienda', params.storeId)] : []),
        ...(params.zoneId ? [filter('zona', params.zoneId)] : []),
        ...(params.segmentId ? [filter('segmento', String(params.segmentId))] : []),
      ],
      results: outcome.rules.map((r) => ({
        id: randomUUID(),
        // Misma precisión que tenían las columnas en Postgres (numeric(6,5) y
        // (10,4)): el contrato y las pruebas comparan estas cifras.
        support: round(r.support, 5),
        confidence: round(r.confidence, 5),
        lift: round(r.lift, 4),
        transactionCount: r.count,
        items: [
          ...r.antecedent.map((productId): ItemRegla => ({ productId, side: 'antecedente' })),
          ...r.consequent.map((productId): ItemRegla => ({ productId, side: 'consecuente' })),
        ],
      })),
      snapshot: fotoDe(baskets),
    };
  }

  /**
   * Deja constancia de un intento fallido con su periodo, parámetros y
   * mensaje. Si esto también falla, solo se registra en el log: no debe
   * ocultar el error original.
   */
  private async recordFailedRun(
    algoritmo: Algoritmo,
    params: AprioriParamsDto,
    user: SesionUsuario,
    period: Period,
    maxItemsetSize: number,
    error: unknown,
  ): Promise<string | null> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `Corrida de ${ALGORITMOS[algoritmo].nombre} fallida: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
    try {
      const fallida = await this.corridas.guardar({
        status: 'fallida',
        userId: user.id,
        periodStart: period.start,
        periodEnd: period.end,
        transactionsConsidered: null,
        basketsConsidered: null,
        errorMessage: message,
        parameters: algorithmParameters(algoritmo, params, maxItemsetSize),
        assumptions: [],
        filters: [],
        results: [],
        snapshot: null,
      });
      return fallida._id;
    } catch (recordError) {
      this.logger.error(`No se pudo registrar la corrida fallida: ${String(recordError)}`);
      return null;
    }
  }

  /**
   * Reglas de una corrida con sus productos, en el orden de `compararReglas`
   * (de la más confiable a la menos), así una corrida recién hecha y la misma
   * releída salen idénticas.
   */
  private async reglasConProductos(runId: string, reglas: ReglaGuardada[]): Promise<ReglaConProductos[]> {
    const ordenadas = [...reglas].sort(compararReglas);

    // Productos de catalog: solo el resumen que muestra el contrato.
    const productos = await this.fuente.resumenDeProductos(ordenadas.flatMap((r) => r.items.map((i) => i.productId)));
    return ordenadas.map((rule) => ({
      id: rule.id,
      runId,
      support: rule.support,
      confidence: rule.confidence,
      lift: rule.lift,
      transactionCount: rule.transactionCount,
      items: rule.items
        .map((item) => ({ ruleId: rule.id, productId: item.productId, side: item.side, product: productos.get(item.productId) ?? null }))
        .sort(
          (a, b) =>
            (a.side === b.side ? 0 : a.side === 'antecedente' ? -1 : 1) ||
            (a.product?.nombre ?? '').localeCompare(b.product?.nombre ?? '', 'es') ||
            // Dos productos con el mismo nombre: el id fija el orden.
            compareItems([a.productId], [b.productId]),
        ),
    }));
  }
}

/** Lo que `compararReglas` necesita de una regla guardada. */
export type ReglaParaOrdenar = Pick<ReglaGuardada, 'confidence' | 'lift' | 'support'> & {
  items: Pick<ItemRegla, 'productId' | 'side'>[];
};

/**
 * Orden de las reglas de una corrida (ALG-06), el mismo que usa `apriori()`:
 * confianza, lift (nulos al final) y soporte, de mayor a menor. Los empates
 * se rompen por CONTENIDO —ids del antecedente y luego del consecuente,
 * como conjuntos ordenados— y nunca por el id de la regla, que es un UUID
 * aleatorio: así dos corridas idénticas devuelven las reglas en el mismo
 * orden. Al guardarse, las métricas se redondean (5 y 4 decimales) y
 * pueden aparecer empates que en memoria no había; el desempate los cubre.
 */
export function compararReglas(a: ReglaParaOrdenar, b: ReglaParaOrdenar): number {
  const lado = (regla: ReglaParaOrdenar, side: LadoRegla) =>
    regla.items
      .filter((item) => item.side === side)
      .map((item) => item.productId)
      .sort();
  return (
    b.confidence - a.confidence ||
    Number(a.lift === null) - Number(b.lift === null) ||
    (b.lift ?? 0) - (a.lift ?? 0) ||
    b.support - a.support ||
    compareItems(lado(a, 'antecedente'), lado(b, 'antecedente')) ||
    compareItems(lado(a, 'consecuente'), lado(b, 'consecuente'))
  );
}

/**
 * Foto de los datos (D-15): hash SHA-256 de las canastas como conjuntos
 * ordenados, en orden. No depende del orden en que llegaron las líneas ni
 * de si un producto se repite en la canasta (dos presentaciones).
 */
export function fotoDe(baskets: string[][]): FotoDatos {
  const canonicas = baskets.map((b) => [...new Set(b)].sort().join(',')).sort();
  return { hash: createHash('sha256').update(canonicas.join('\n')).digest('hex'), baskets: baskets.length };
}

function groupByBasket(lines: BasketLine[]): { baskets: string[][]; categoryOf: Map<string, number> } {
  const byBasket = new Map<string, string[]>();
  const categoryOf = new Map<string, number>();
  for (const line of lines) {
    const products = byBasket.get(line.basketId) ?? [];
    products.push(line.productId);
    byBasket.set(line.basketId, products);
    categoryOf.set(line.productId, line.categoryId);
  }
  return { baskets: [...byBasket.values()], categoryOf };
}

/** Una regla se descarta si un producto de cada lado cae en un par de categorías excluido. */
function isExcluded(rule: AprioriRule, categoryOf: Map<string, number>, excludedPairs: Set<string>): boolean {
  if (excludedPairs.size === 0) return false;
  return rule.antecedent.some((a) =>
    rule.consequent.some((c) => {
      const categoryA = categoryOf.get(a)!;
      const categoryC = categoryOf.get(c)!;
      return categoryA !== categoryC && excludedPairs.has(pairKey(categoryA, categoryC));
    }),
  );
}

/** La base guarda el par ordenado (chk_exclusion_par_canonico). */
function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** `algoritmo` es el `AnalysisRun.algorithm` de D2: un parámetro de la corrida. */
function algorithmParameters(algoritmo: Algoritmo, params: AprioriParamsDto, maxItemsetSize: number): ParametroCorrida[] {
  return [
    param('algoritmo', algoritmo),
    param('soporte_minimo', params.minSupport),
    param('confianza_minima', params.minConfidence),
    param('tamano_maximo_itemset', maxItemsetSize),
  ];
}

function param(key: string, value: string | number): ParametroCorrida {
  return { key, value: String(value) };
}

function filter(dimension: DimensionFiltro, referenceId: string): FiltroCorrida {
  return { dimension, referenceId };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
