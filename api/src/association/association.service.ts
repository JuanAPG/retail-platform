import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UsuarioSolicitante } from '../common/roles';
import { AnalysisRun } from '../entities/analysis-run.entity';
import { AnalysisRunParameter } from '../entities/analysis-run-parameter.entity';
import { AnalysisRunAssumption } from '../entities/analysis-run-assumption.entity';
import { AnalysisRunFilter } from '../entities/analysis-run-filter.entity';
import { AssociationRule } from '../entities/association-rule.entity';
import { AssociationRuleItem } from '../entities/association-rule-item.entity';
import { AssociationExclusion } from '../entities/association-exclusion.entity';
import { Basket } from '../entities/basket.entity';
import { TransactionDetail } from '../entities/transaction-detail.entity';
import { apriori, AprioriRule } from './apriori';
import { AprioriParamsDto } from './dto/apriori-params.dto';

const DEFAULT_MAX_ITEMSET_SIZE = 3;
/** Filas por INSERT: lejos del límite de 65 535 parámetros de Postgres. */
const INSERT_CHUNK = 1000;

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

/**
 * M10 — Reglas de asociación (Apriori), según Contrato de Métodos y
 * Endpoints. Cada corrida se guarda completa (parámetros, supuestos,
 * filtros, periodo, usuario y reglas) para poder reproducirla (RF-15).
 */
@Injectable()
export class AssociationService {
  private readonly logger = new Logger(AssociationService.name);

  constructor(
    @InjectRepository(AssociationRule)
    private readonly rulesRepo: Repository<AssociationRule>,
    @InjectRepository(AssociationExclusion)
    private readonly exclusionsRepo: Repository<AssociationExclusion>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Corre Apriori sobre las canastas filtradas y guarda la corrida vía
   * saveRun. `user` no está en la firma del contrato, pero la corrida
   * debe registrar quién la ejecutó y solo el controlador conoce el JWT
   * (mismo patrón que TransactionsService.createManual).
   *
   * Errores de entrada (fechas invertidas, sin canastas) responden 400 y
   * no generan corrida. Una falla después de leer los datos deja la
   * corrida registrada como `fallida`.
   */
  async runApriori(params: AprioriParamsDto, user: UsuarioSolicitante): Promise<AssociationRule[]> {
    if (params.dateFrom && params.dateTo && params.dateTo.slice(0, 10) < params.dateFrom.slice(0, 10)) {
      throw new BadRequestException('La fecha final no puede ser anterior a la inicial.');
    }

    const lines = await this.loadBasketLines(params);
    if (lines.length === 0) {
      throw new BadRequestException('No hay canastas para los filtros indicados.');
    }

    const period = this.periodOf(params, lines);
    const maxItemsetSize = params.maxItemsetSize ?? DEFAULT_MAX_ITEMSET_SIZE;

    let runId: string;
    try {
      const { baskets, categoryOf } = groupByBasket(lines);
      const { rules } = apriori(baskets, {
        minSupport: params.minSupport,
        minConfidence: params.minConfidence,
        maxItemsetSize,
      });

      const excludedPairs = await this.loadExcludedCategoryPairs();
      const kept = rules.filter((rule) => !isExcluded(rule, categoryOf, excludedPairs));

      const run = this.buildRun(params, user, period, baskets.length, maxItemsetSize, {
        generated: rules.length,
        excluded: rules.length - kept.length,
        rules: kept,
      });
      runId = (await this.saveRun(run)).id;
    } catch (error) {
      await this.recordFailedRun(params, user, period, maxItemsetSize, error);
      throw new InternalServerErrorException(
        'No se pudo completar la corrida de Apriori; quedó registrada como fallida.',
      );
    }

    return this.findRulesOfRun(runId);
  }

  /**
   * Guarda la corrida y todo lo que cuelga de ella en UNA transacción:
   * si algo falla a la mitad no queda una corrida "completada" con
   * reglas faltantes. Cada tabla se inserta de forma explícita (sin
   * cascade de TypeORM, que con llaves compuestas falla en silencio).
   */
  async saveRun(run: AnalysisRun): Promise<AnalysisRun> {
    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(
        manager.create(AnalysisRun, {
          type: run.type,
          status: run.status,
          userId: run.userId,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          transactionsConsidered: run.transactionsConsidered,
          basketsConsidered: run.basketsConsidered,
          errorMessage: run.errorMessage ?? null,
        }),
      );

      const parameters = (run.parameters ?? []).map((p) => ({ runId: saved.id, key: p.key, value: p.value }));
      const assumptions = (run.assumptions ?? []).map((a) => ({
        runId: saved.id,
        order: a.order,
        assumption: a.assumption,
      }));
      const filters = (run.filters ?? []).map((f) => ({
        runId: saved.id,
        dimension: f.dimension,
        referenceId: f.referenceId,
      }));
      // Id generado aquí para enlazar los ítems sin depender del orden en
      // que Postgres devuelva los ids de un INSERT múltiple.
      const results = (run.results ?? []).map((r) => ({ ...r, id: r.id ?? randomUUID(), runId: saved.id }));
      const rules = results.map(({ items: _items, run: _run, ...rule }) => rule);
      const items = results.flatMap((r) =>
        (r.items ?? []).map((i) => ({ ruleId: r.id, productId: i.productId, side: i.side })),
      );

      await insertInChunks(manager, AnalysisRunParameter, parameters);
      await insertInChunks(manager, AnalysisRunAssumption, assumptions);
      await insertInChunks(manager, AnalysisRunFilter, filters);
      await insertInChunks(manager, AssociationRule, rules);
      await insertInChunks(manager, AssociationRuleItem, items);

      return Object.assign(saved, { parameters, assumptions, filters, results }) as AnalysisRun;
    });
  }

  /**
   * Un renglón por (canasta, producto). Mismos filtros y mismo criterio
   * que AnalyticsService (M09): tienda vía la transacción, `dateTo`
   * inclusivo del día completo. Se escribe aquí y no se reutiliza el de
   * M09 porque aquel es privado y cambiarlo sería tocar otro módulo.
   */
  private async loadBasketLines(params: AprioriParamsDto): Promise<BasketLine[]> {
    const qb = this.dataSource
      .getRepository(Basket)
      .createQueryBuilder('basket')
      .innerJoin(TransactionDetail, 'detail', 'detail.transactionId = basket.transactionId')
      .innerJoin('detail.presentation', 'presentation')
      .innerJoin('presentation.producto', 'product')
      .select('basket.id', 'basketId')
      .addSelect('product.id', 'productId')
      .addSelect('product.categoriaId', 'categoryId')
      .addSelect(`to_char(basket.date, 'YYYY-MM-DD')`, 'day')
      // DISTINCT: dos presentaciones del mismo producto son un solo producto.
      .distinct(true);

    if (params.zoneId) qb.andWhere('basket.zoneId = :zoneId', { zoneId: params.zoneId });
    if (params.segmentId) qb.andWhere('basket.segmentId = :segmentId', { segmentId: params.segmentId });
    if (params.dateFrom) qb.andWhere('basket.date >= :dateFrom', { dateFrom: params.dateFrom });
    if (params.dateTo) qb.andWhere('basket.date < CAST(:dateTo AS date) + 1', { dateTo: params.dateTo });
    if (params.storeId) {
      qb.innerJoin('basket.transaction', 'transaction').andWhere('transaction.storeId = :storeId', {
        storeId: params.storeId,
      });
    }

    const rows = await qb.getRawMany<{ basketId: string; productId: string; categoryId: number; day: string }>();
    return rows.map((row) => ({ ...row, categoryId: Number(row.categoryId) }));
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
      start: params.dateFrom?.slice(0, 10) ?? days[0],
      end: params.dateTo?.slice(0, 10) ?? days[days.length - 1],
    };
  }

  private buildRun(
    params: AprioriParamsDto,
    user: UsuarioSolicitante,
    period: Period,
    basketCount: number,
    maxItemsetSize: number,
    outcome: { generated: number; excluded: number; rules: AprioriRule[] },
  ): AnalysisRun {
    const run = new AnalysisRun();
    run.type = 'asociacion';
    run.status = 'completada';
    run.userId = user.id;
    run.periodStart = period.start;
    run.periodEnd = period.end;
    // Una canasta = una transacción (RN-03).
    run.transactionsConsidered = basketCount;
    run.basketsConsidered = basketCount;

    run.parameters = [
      ...algorithmParameters(params, maxItemsetSize),
      param('reglas_generadas', outcome.generated),
      param('reglas_excluidas_rn10', outcome.excluded),
    ];

    const assumptions = [
      'Una canasta equivale a una transacción (RN-03).',
      'Las presentaciones se agrupan en su producto y la cantidad comprada no pondera: cuenta presencia o ausencia.',
      `Se aplicaron las exclusiones de categorías vigentes (RN-10): ${outcome.excluded} regla(s) descartada(s).`,
    ];
    if (params.segmentId) {
      assumptions.push('El segmento de ingreso es el de la zona de la compra, no el de la persona (RN-02).');
    }
    run.assumptions = assumptions.map((assumption, n) => Object.assign(new AnalysisRunAssumption(), { order: n + 1, assumption }));

    run.filters = [
      ...(params.storeId ? [filter('tienda', params.storeId)] : []),
      ...(params.zoneId ? [filter('zona', params.zoneId)] : []),
      ...(params.segmentId ? [filter('segmento', String(params.segmentId))] : []),
    ];

    run.results = outcome.rules.map((r) =>
      Object.assign(new AssociationRule(), {
        // Precisión de las columnas: numeric(6,5) y numeric(10,4).
        support: round(r.support, 5),
        confidence: round(r.confidence, 5),
        lift: round(r.lift, 4),
        transactionCount: r.count,
        items: [
          ...r.antecedent.map((productId) => Object.assign(new AssociationRuleItem(), { productId, side: 'antecedente' })),
          ...r.consequent.map((productId) => Object.assign(new AssociationRuleItem(), { productId, side: 'consecuente' })),
        ],
      }),
    );

    return run;
  }

  /**
   * Deja constancia de un intento fallido con su periodo, parámetros y
   * mensaje (chk_corrida_error exige el mensaje). Si esto también falla,
   * solo se registra en el log: no debe ocultar el error original.
   */
  private async recordFailedRun(
    params: AprioriParamsDto,
    user: UsuarioSolicitante,
    period: Period,
    maxItemsetSize: number,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Corrida de Apriori fallida: ${message}`, error instanceof Error ? error.stack : undefined);
    try {
      const run = new AnalysisRun();
      run.type = 'asociacion';
      run.status = 'fallida';
      run.userId = user.id;
      run.periodStart = period.start;
      run.periodEnd = period.end;
      run.transactionsConsidered = null;
      run.basketsConsidered = null;
      run.errorMessage = message;
      run.parameters = algorithmParameters(params, maxItemsetSize);
      await this.saveRun(run);
    } catch (recordError) {
      this.logger.error(`No se pudo registrar la corrida fallida: ${String(recordError)}`);
    }
  }

  /** Reglas de una corrida con sus productos, de la más confiable a la menos. */
  private async findRulesOfRun(runId: string): Promise<AssociationRule[]> {
    // QueryBuilder y no find(): find() cargaría las relaciones eager de
    // producto (proveedor incluido), que aquí no hacen falta.
    const rules = await this.rulesRepo
      .createQueryBuilder('rule')
      .leftJoinAndSelect('rule.items', 'item')
      .leftJoin('item.product', 'product')
      .addSelect(['product.id', 'product.sku', 'product.nombre', 'product.categoriaId'])
      .where('rule.runId = :runId', { runId })
      .orderBy('rule.confidence', 'DESC')
      .addOrderBy('rule.lift', 'DESC', 'NULLS LAST')
      .addOrderBy('rule.support', 'DESC')
      .addOrderBy('rule.id', 'ASC')
      .getMany();

    for (const rule of rules) {
      rule.items.sort(
        (a, b) =>
          (a.side === b.side ? 0 : a.side === 'antecedente' ? -1 : 1) ||
          a.product.nombre.localeCompare(b.product.nombre, 'es'),
      );
    }
    return rules;
  }
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

function algorithmParameters(params: AprioriParamsDto, maxItemsetSize: number): AnalysisRunParameter[] {
  return [
    param('algoritmo', 'apriori'),
    param('soporte_minimo', params.minSupport),
    param('confianza_minima', params.minConfidence),
    param('tamano_maximo_itemset', maxItemsetSize),
  ];
}

function param(key: string, value: string | number): AnalysisRunParameter {
  return Object.assign(new AnalysisRunParameter(), { key, value: String(value) });
}

function filter(dimension: AnalysisRunFilter['dimension'], referenceId: string): AnalysisRunFilter {
  return Object.assign(new AnalysisRunFilter(), { dimension, referenceId });
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function insertInChunks<T>(
  manager: EntityManager,
  entity: new () => T,
  rows: object[],
): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    await manager.insert(entity, rows.slice(start, start + INSERT_CHUNK) as never);
  }
}
