import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
import { Pagina, PaginationDto } from '../common/dto/pagination.dto';
import { paginar } from '../common/helpers/pagination.helper';
import { Scenario } from '../entities/scenario.entity';
import { ScenarioChange, ScenarioChangeType } from '../entities/scenario-change.entity';
import { ScenarioResult } from '../entities/scenario-result.entity';
import { PriceSimulationDto } from './dto/price-simulation.dto';
import { PresentationSimulationDto } from './dto/presentation-simulation.dto';
import {
  PresentationComparisonItem,
  PresentationComparisonResult,
  PresentationPriceStatus,
} from './dto/presentation-comparison-result.dto';
import { SimulationResult, SimulationResultItem } from './dto/simulation-result.dto';
import { ScenarioComparison, ScenarioComparisonEntry } from './dto/scenario-comparison.dto';
import { ScenarioSnapshot, ScenarioSummary, ScenarioType } from './dto/scenario-summary.dto';

interface ChangeInput {
  presentationId: string;
  type: ScenarioChangeType;
  previousValue: number | null;
  newValue: number;
}

interface ResultInput {
  indicatorKey: string;
  zoneId: string | null;
  baseValue: number;
  simulatedValue: number;
}

/** Presentación del producto con lo necesario para llevarla a unidad base. */
interface PresentacionProducto {
  id: string;
  nombre: string;
  activo: boolean;
  predeterminada: boolean;
  tipoUnidad: string;
  /** Contenido en la unidad base de su tipo (kg, l, pza, m). */
  contenidoBase: number;
}

/** `escenarios.nombre` es VARCHAR(120). */
const NOMBRE_MAXIMO = 120;
const PRESENTACIONES_MINIMAS = 2;
const UNIQUE_VIOLATION = '23505';
/** Caracteres del UUID del escenario que van al final de su nombre. */
const LARGO_SUFIJO_NOMBRE = 6;
const INTENTOS_GUARDADO = 3;

/** Unidad base de cada `tipo_unidad` (a la que lleva `unidades_medida.factor_base`). */
const UNIDAD_BASE: Record<string, string> = { masa: 'kg', volumen: 'l', pieza: 'pza', longitud: 'm' };

const SUPUESTO_SIN_INSUMOS =
  'Escenario guardado antes de registrar insumos: no se conservaron la elasticidad, el precio actual ni la demanda base.';

/** Fecha en el nombre del escenario en formato legible ("08/10/26, 6:52:25 p.m."), no ISO crudo. */
function formatearFecha(fecha: Date): string {
  return fecha.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' });
}

/**
 * Nombre único por construcción: `escenarios` tiene UNIQUE (nombre,
 * creado_por) y la fecha sola no alcanza (dos simulaciones del mismo
 * producto en el mismo segundo chocaban), así que termina con el inicio
 * del UUID del propio escenario. Se recorta el título, nunca el sufijo.
 */
function nombreEscenario(titulo: string, escenarioId: string): string {
  const sufijo = ` (${formatearFecha(new Date())}) #${escenarioId.slice(0, LARGO_SUFIJO_NOMBRE)}`;
  return titulo.slice(0, NOMBRE_MAXIMO - sufijo.length) + sufijo;
}

function redondear(valor: number): number {
  return Number(valor.toFixed(4));
}

/**
 * M13 — Simulación de escenarios, según Contrato de Métodos y Endpoints.
 * Cada simulación (precio o presentación) se guarda automáticamente como
 * escenario (`escenarios` + `escenario_cambios` + `escenario_resultados`).
 * `saveScenario` no tiene endpoint propio, es un método interno.
 */
@Injectable()
export class SimulationService {
  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(ScenarioChange)
    private readonly changeRepo: Repository<ScenarioChange>,
    @InjectRepository(ScenarioResult)
    private readonly resultRepo: Repository<ScenarioResult>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * `user` no está en la firma del contrato, pero `escenarios.creado_por`
   * es NOT NULL y solo el controlador conoce el token (mismo patrón que
   * ElasticityService.calculate en M11).
   */
  async simulatePriceChange(dto: PriceSimulationDto, user: SesionUsuario): Promise<SimulationResult> {
    const info = await this.presentacionInfo(dto.presentationId);
    const precioActual = await this.precioPromedioZona(dto.presentationId, dto.zoneId);
    if (precioActual <= 0) {
      throw new NotFoundException('No hay precio vigente registrado para esa presentación en esa zona.');
    }
    const demandaBase = await this.demandaHistorica(dto.presentationId, dto.zoneId);
    const elasticidad = await this.elasticidadDe(dto.presentationId, dto.zoneId);

    const demandaSimulada = demandaBase * Math.pow(dto.newPrice / precioActual, elasticidad.valor);
    const ingresoBase = demandaBase * precioActual;
    const ingresoSimulado = demandaSimulada * dto.newPrice;
    const segmentId = await this.findSegmentId(dto.zoneId);

    const results: ResultInput[] = [
      { indicatorKey: 'demanda_estimada', zoneId: dto.zoneId, baseValue: demandaBase, simulatedValue: demandaSimulada },
      { indicatorKey: 'ingreso_estimado', zoneId: dto.zoneId, baseValue: ingresoBase, simulatedValue: ingresoSimulado },
    ];
    const changes: ChangeInput[] = [
      { presentationId: dto.presentationId, type: 'precio', previousValue: precioActual, newValue: dto.newPrice },
    ];
    const assumptions = [
      `Elasticidad ${elasticidad.valor} tomada de la corrida ${elasticidad.corridaId} (${
        elasticidad.esNacional ? 'agregado nacional, porque no hay corrida para la zona' : 'calculada para la zona'
      }); queda guardada con el escenario aunque después se recalcule.`,
      'Demanda simulada = demanda base × (precio nuevo / precio actual) ^ elasticidad (elasticidad constante).',
      'La demanda base es la suma de unidades vendidas de la presentación en todo el histórico de transacciones de la zona.',
      'El precio actual es el promedio de los precios vigentes de la presentación en las tiendas de la zona.',
    ];

    const escenario = await this.saveScenario(
      {
        titulo: `Cambio de precio - ${info.productName} ${info.presentationName}`,
        zonaId: dto.zoneId,
        corridaId: elasticidad.corridaId,
        changes,
        results,
        snapshot: {
          version: 1,
          type: 'precio',
          productId: info.productId,
          presentationId: dto.presentationId,
          elasticity: elasticidad.valor,
          elasticityRunId: elasticidad.corridaId,
          currentPrice: precioActual,
          newPrice: dto.newPrice,
          baseDemand: demandaBase,
          presentations: [],
          assumptions,
          warnings: [],
          results,
        },
      },
      user,
    );

    return {
      type: 'price',
      productId: info.productId,
      presentationId: dto.presentationId,
      zoneId: dto.zoneId,
      segmentId,
      inputs: {
        currentPrice: precioActual,
        newPrice: dto.newPrice,
        baseDemand: demandaBase,
        elasticity: elasticidad.valor,
        elasticityRunId: elasticidad.corridaId,
      },
      results: results.map((r) => this.toItem(r)),
      scenarioId: escenario.id,
      assumptions,
    };
  }

  /**
   * D-14: compara las presentaciones de UN producto (sin sustitutos ni
   * otros productos). Una presentación sin precio vigente no se calcula
   * con 0: se marca, se excluye y se avisa en `warnings`.
   */
  async simulatePresentationChange(
    dto: PresentationSimulationDto,
    user: SesionUsuario,
  ): Promise<PresentationComparisonResult> {
    const productId = dto.productId.toLowerCase();
    const zoneId = dto.zoneId?.toLowerCase() ?? null;

    const productName = await this.nombreProducto(productId);
    if (zoneId) await this.verificarZona(zoneId);
    const presentaciones = await this.presentacionesAComparar(productId, productName, dto.presentationIds);

    const ids = presentaciones.map((p) => p.id);
    const [precios, demandas, segmento] = await Promise.all([
      this.preciosVigentes(ids, zoneId),
      this.demandasHistoricas(ids, zoneId),
      zoneId ? this.segmentoDeZona(zoneId) : null,
    ]);

    const lugar = zoneId ? 'en la zona' : 'a nivel nacional';
    const sinPrecio: PresentationPriceStatus = zoneId ? 'sin_precio_en_la_zona' : 'sin_precio_vigente';
    const warnings: string[] = [];

    const conPrecio = presentaciones.filter((p) => precios.has(p.id));
    for (const p of presentaciones.filter((x) => !precios.has(x.id))) {
      warnings.push(
        `La presentación "${p.nombre}" (${p.id}) no tiene precio vigente ${lugar}: se marcó como ` +
          `"${sinPrecio}" y se excluyó de los cálculos.`,
      );
    }
    if (conPrecio.length < PRESENTACIONES_MINIMAS) {
      throw new NotFoundException(
        `Solo ${conPrecio.length} de las ${presentaciones.length} presentaciones de "${productName}" tiene precio ` +
          `vigente ${lugar}; se necesitan al menos ${PRESENTACIONES_MINIMAS} con precio para comparar.`,
      );
    }

    const precioUnitario = (p: PresentacionProducto) => (precios.get(p.id) as number) / p.contenidoBase;

    // El sobreprecio por unidad solo tiene sentido entre presentaciones del
    // mismo tipo de unidad (no se compara $/kg contra $/pza).
    const minimoPorTipo = new Map<string, number>();
    for (const p of conPrecio) {
      const actual = minimoPorTipo.get(p.tipoUnidad);
      const unitario = precioUnitario(p);
      if (actual === undefined || unitario < actual) minimoPorTipo.set(p.tipoUnidad, unitario);
    }
    if (minimoPorTipo.size > 1) {
      warnings.push(
        `Las presentaciones comparadas usan tipos de unidad distintos (${[...minimoPorTipo.keys()].join(', ')}): ` +
          'el precio por unidad base solo es comparable entre presentaciones del mismo tipo.',
      );
    }
    if (zoneId && !segmento) {
      warnings.push(
        'La zona no tiene un segmento de ingreso vigente: no se calculó el desembolso como porcentaje del ingreso.',
      );
    }

    const items: PresentationComparisonItem[] = presentaciones.map((p) => {
      const base = {
        presentationId: p.id,
        presentationName: p.nombre,
        baseUnit: UNIDAD_BASE[p.tipoUnidad] ?? p.tipoUnidad,
      };
      const precio = precios.get(p.id);
      if (precio === undefined) {
        return {
          ...base,
          priceStatus: sinPrecio,
          outlay: null,
          unitPrice: null,
          estimatedDemand: null,
          accessibilityEffect: null,
        };
      }
      const unitario = precioUnitario(p);
      const minimo = minimoPorTipo.get(p.tipoUnidad) as number;
      return {
        ...base,
        priceStatus: 'con_precio',
        outlay: redondear(precio),
        unitPrice: redondear(unitario),
        estimatedDemand: demandas.get(p.id) ?? 0,
        accessibilityEffect: {
          incomeSharePct: segmento ? redondear((precio / segmento.ingresoEstimado) * 100) : null,
          unitPricePremiumPct: redondear(((unitario - minimo) / minimo) * 100),
        },
      };
    });

    // `results` resume la comparación en un par base → simulado para que el
    // escenario sea comparable con otros: la referencia es la presentación
    // predeterminada (o la de menor contenido) y se contrasta con la más
    // barata por unidad base entre las demás.
    const referencia =
      conPrecio.find((p) => p.predeterminada) ??
      [...conPrecio].sort((a, b) => a.contenidoBase - b.contenidoBase)[0];
    const otras = conPrecio.filter((p) => p.id !== referencia.id);
    const mismoTipo = otras.filter((p) => p.tipoUnidad === referencia.tipoUnidad);
    const comparada = [...(mismoTipo.length > 0 ? mismoTipo : otras)].sort(
      (a, b) => precioUnitario(a) - precioUnitario(b) || b.contenidoBase - a.contenidoBase,
    )[0];

    const demandaResultado: ResultInput = {
      indicatorKey: 'demanda_estimada',
      zoneId,
      baseValue: demandas.get(referencia.id) ?? 0,
      simulatedValue: demandas.get(comparada.id) ?? 0,
    };
    const results: ResultInput[] = [
      {
        indicatorKey: 'desembolso',
        zoneId,
        baseValue: redondear(precios.get(referencia.id) as number),
        simulatedValue: redondear(precios.get(comparada.id) as number),
      },
    ];
    if (referencia.tipoUnidad === comparada.tipoUnidad) {
      results.push({
        indicatorKey: 'precio_unitario',
        zoneId,
        baseValue: redondear(precioUnitario(referencia)),
        simulatedValue: redondear(precioUnitario(comparada)),
      });
    }
    results.push(demandaResultado);

    const assumptions = [
      `La demanda estimada de cada presentación es la suma de unidades vendidas de esa presentación en todo el ` +
        `histórico de transacciones ${lugar}; no se ajusta por elasticidad porque esta comparación no modifica precios.`,
      'No se usó elasticidad (elasticity y elasticityRunId quedan en null): comparar presentaciones no simula un cambio de precio.',
      `El desembolso es el promedio de los precios vigentes de la presentación en las tiendas ${
        zoneId ? 'de la zona' : 'de todo el país'
      }.`,
      'El precio por unidad base es el desembolso entre el contenido llevado a la unidad base (kg, l, pza o m).',
      'El efecto en accesibilidad es un indicador analítico, no una medida de bienestar: incomeSharePct es el ' +
        'desembolso como porcentaje del ingreso mensual estimado del segmento de la zona (punto medio del rango; ' +
        'en un segmento abierto, 1.25 veces su mínimo) y unitPricePremiumPct es el sobreprecio por unidad base ' +
        'frente a la presentación más barata por unidad.',
      `En results, el valor base es la presentación de referencia "${referencia.nombre}" (la predeterminada o, si ` +
        `no tiene precio, la de menor contenido) y el simulado es "${comparada.nombre}", la más barata por unidad ` +
        'base entre las demás.',
    ];
    if (!zoneId) {
      assumptions.push(
        'Sin zoneId se usan precios y demanda nacionales, y no hay segmento de ingreso: incomeSharePct queda en null.',
      );
    }

    const escenario = await this.saveScenario(
      {
        titulo: `Comparación de presentaciones - ${productName}`,
        zonaId: zoneId,
        corridaId: null,
        // Una fila por presentación evaluada; el valor es su contenido en
        // unidad base (lo que cambia entre empaques). El detalle de precio
        // y demanda va en el snapshot.
        changes: presentaciones.map((p) => ({
          presentationId: p.id,
          type: 'empaque' as const,
          previousValue: null,
          newValue: p.contenidoBase,
        })),
        // El catálogo `indicadores` no tiene `desembolso` ni
        // `precio_unitario`: a la tabla solo va el que sí existe.
        results: [demandaResultado],
        snapshot: {
          version: 1,
          type: 'presentacion',
          productId,
          presentationId: null,
          elasticity: null,
          elasticityRunId: null,
          currentPrice: null,
          newPrice: null,
          baseDemand: null,
          presentations: items,
          assumptions,
          warnings,
          results,
        },
      },
      user,
    );

    return {
      type: 'presentacion',
      scenarioId: escenario.id,
      productId,
      productName,
      zoneId,
      segmentId: segmento?.segmentId ?? null,
      presentations: items,
      referencePresentationId: referencia.id,
      comparedPresentationId: comparada.id,
      results: results.map((r) => this.toItem(r)),
      assumptions,
      warnings,
    };
  }

  async findAllScenarios(filtros: PaginationDto): Promise<Pagina<ScenarioSummary>> {
    const pagina = await paginar(
      this.scenarioRepo.createQueryBuilder('e').orderBy('e.createdAt', 'DESC').addOrderBy('e.id', 'ASC'),
      filtros,
    );
    const snapshots = new Map(pagina.data.map((e) => [e.id, this.leerSnapshot(e)]));
    const tiposInferidos = await this.tiposPorCambios(pagina.data.filter((e) => !snapshots.get(e.id)).map((e) => e.id));

    return {
      ...pagina,
      data: pagina.data.map((e) => {
        const snapshot = snapshots.get(e.id) ?? null;
        return {
          id: e.id,
          name: e.nombre,
          type: snapshot?.type ?? tiposInferidos.get(e.id) ?? 'desconocido',
          zoneId: e.zonaId,
          productId: snapshot?.productId ?? null,
          presentationId: snapshot?.presentationId ?? null,
          elasticity: snapshot?.elasticity ?? null,
          elasticityRunId: snapshot?.elasticityRunId ?? e.corridaId,
          currentPrice: snapshot?.currentPrice ?? null,
          newPrice: snapshot?.newPrice ?? null,
          baseDemand: snapshot?.baseDemand ?? null,
          presentations: snapshot?.presentations ?? [],
          assumptions: snapshot?.assumptions ?? [SUPUESTO_SIN_INSUMOS],
          createdBy: e.creadoPor,
          createdAt: e.createdAt,
        };
      }),
    };
  }

  /** `scenarioIds` llega validado por `CompareScenariosQueryDto` (2+ UUID, sin repetir, en minúsculas). */
  async compareScenarios(scenarioIds: string[]): Promise<ScenarioComparison> {
    const escenarios = await this.scenarioRepo.findBy({ id: In(scenarioIds) });
    const porId = new Map(escenarios.map((e) => [e.id, e]));
    const faltantes = scenarioIds.filter((id) => !porId.has(id));
    if (faltantes.length > 0) {
      throw new NotFoundException(`No existen los escenarios: ${faltantes.join(', ')}.`);
    }

    const snapshots = new Map(escenarios.map((e) => [e.id, this.leerSnapshot(e)]));
    // Los escenarios anteriores al snapshot solo tienen lo que quedó en las tablas.
    const sinSnapshot = scenarioIds.filter((id) => !snapshots.get(id));
    const [tiposInferidos, resultadosTabla] = await Promise.all([
      this.tiposPorCambios(sinSnapshot),
      this.resultadosDeTabla(sinSnapshot),
    ]);

    const scenarios: ScenarioComparisonEntry[] = scenarioIds.map((id) => {
      const escenario = porId.get(id) as Scenario;
      const snapshot = snapshots.get(id) ?? null;
      const results = snapshot?.results ?? resultadosTabla.get(id) ?? [];
      return {
        scenarioId: id,
        name: escenario.nombre,
        type: snapshot?.type ?? tiposInferidos.get(id) ?? 'desconocido',
        zoneId: escenario.zonaId,
        elasticity: snapshot?.elasticity ?? null,
        elasticityRunId: snapshot?.elasticityRunId ?? escenario.corridaId,
        results: results.map((r) => ({
          ...this.toItem(r),
          difference: redondear(r.simulatedValue - r.baseValue),
        })),
      };
    });

    const tipos = [...new Set(scenarios.map((s) => s.type))];
    const warnings =
      tipos.length > 1
        ? [
            `Se están comparando escenarios de tipos distintos (${tipos.join(', ')}): sus indicadores no miden ` +
              'lo mismo y no son directamente comparables.',
          ]
        : [];

    return { scenarioIds, scenarios, warnings };
  }

  /**
   * Persiste escenario + cambios + resultados en una sola transacción.
   * Sin endpoint propio: la llaman internamente simulatePriceChange y
   * simulatePresentationChange. El tipo y los insumos van como JSON en
   * `descripcion` (ver `ScenarioSnapshot`); `corrida_id` apunta a la
   * corrida de elasticidad usada, si hubo.
   *
   * El id se genera aquí (no en la base) porque su inicio forma parte del
   * nombre. Si aun así el nombre choca, se reintenta con otro id; el 409
   * queda solo como último recurso.
   */
  private async saveScenario(
    input: {
      titulo: string;
      zonaId: string | null;
      corridaId: string | null;
      changes: ChangeInput[];
      results: ResultInput[];
      snapshot: ScenarioSnapshot;
    },
    user: SesionUsuario,
  ): Promise<Scenario> {
    for (let intento = 1; ; intento++) {
      const id = randomUUID();
      try {
        return await this.guardarEscenario(id, nombreEscenario(input.titulo, id), input, user);
      } catch (error) {
        const codigo = error instanceof QueryFailedError ? (error.driverError as { code?: string })?.code : undefined;
        if (codigo !== UNIQUE_VIOLATION) throw error;
        if (intento >= INTENTOS_GUARDADO) {
          throw new ConflictException('No se pudo guardar el escenario con un nombre único; vuelve a intentarlo.');
        }
      }
    }
  }

  private guardarEscenario(
    id: string,
    nombre: string,
    input: {
      zonaId: string | null;
      corridaId: string | null;
      changes: ChangeInput[];
      results: ResultInput[];
      snapshot: ScenarioSnapshot;
    },
    user: SesionUsuario,
  ): Promise<Scenario> {
    return this.dataSource.transaction(async (manager) => {
      const escenario = await manager.save(
        manager.create(Scenario, {
          id,
          nombre,
          descripcion: JSON.stringify(input.snapshot),
          escenarioBaseId: null,
          corridaId: input.corridaId,
          zonaId: input.zonaId,
          creadoPor: user.id,
        }),
      );

      await manager.insert(
        ScenarioChange,
        input.changes.map((c) => ({
          escenarioId: escenario.id,
          presentacionId: c.presentationId,
          tipo: c.type,
          valorAnterior: c.previousValue !== null ? String(c.previousValue) : null,
          valorNuevo: String(c.newValue),
        })),
      );

      const resultados = await Promise.all(
        input.results.map(async (r) => ({
          escenarioId: escenario.id,
          indicadorId: await this.indicadorIdPorClave(r.indicatorKey),
          zonaId: r.zoneId,
          valorBase: String(r.baseValue),
          valorSimulado: String(r.simulatedValue),
        })),
      );
      await manager.insert(ScenarioResult, resultados);

      return escenario;
    });
  }

  /** Lee el JSON de `descripcion`; null si el escenario es anterior al snapshot o no es JSON. */
  private leerSnapshot(escenario: Scenario): ScenarioSnapshot | null {
    if (!escenario.descripcion) return null;
    try {
      const datos = JSON.parse(escenario.descripcion) as Partial<ScenarioSnapshot> | null;
      const tipoValido = datos?.type === 'precio' || datos?.type === 'presentacion';
      if (!datos || !tipoValido || !Array.isArray(datos.results)) return null;
      return {
        ...(datos as ScenarioSnapshot),
        presentations: datos.presentations ?? [],
        assumptions: datos.assumptions ?? [],
        warnings: datos.warnings ?? [],
      };
    } catch {
      return null;
    }
  }

  /** Tipo de los escenarios sin snapshot, inferido de lo que cambiaron (`escenario_cambios.tipo`). */
  private async tiposPorCambios(scenarioIds: string[]): Promise<Map<string, ScenarioType>> {
    const tipos = new Map<string, ScenarioType>();
    if (scenarioIds.length === 0) return tipos;
    const filas: { escenarioId: string; tipo: string }[] = await this.dataSource.query(
      `
      SELECT escenario_id AS "escenarioId", MIN(tipo::text) AS tipo
      FROM escenario_cambios
      WHERE escenario_id = ANY($1::uuid[])
      GROUP BY escenario_id
      `,
      [scenarioIds],
    );
    for (const f of filas) {
      if (f.tipo === 'precio') tipos.set(f.escenarioId, 'precio');
      else if (f.tipo === 'empaque') tipos.set(f.escenarioId, 'presentacion');
    }
    return tipos;
  }

  private async resultadosDeTabla(scenarioIds: string[]): Promise<Map<string, ResultInput[]>> {
    const resultados = new Map<string, ResultInput[]>();
    if (scenarioIds.length === 0) return resultados;
    const filas: {
      escenarioId: string;
      indicatorKey: string;
      zoneId: string | null;
      valorBase: string;
      valorSimulado: string;
    }[] = await this.dataSource.query(
      `
      SELECT r.escenario_id AS "escenarioId", i.clave AS "indicatorKey", r.zona_id AS "zoneId",
             r.valor_base AS "valorBase", r.valor_simulado AS "valorSimulado"
      FROM escenario_resultados r
      JOIN indicadores i ON i.id = r.indicador_id
      WHERE r.escenario_id = ANY($1::uuid[])
      ORDER BY i.clave
      `,
      [scenarioIds],
    );
    for (const f of filas) {
      const lista = resultados.get(f.escenarioId) ?? [];
      lista.push({
        indicatorKey: f.indicatorKey,
        zoneId: f.zoneId,
        baseValue: Number(f.valorBase),
        simulatedValue: Number(f.valorSimulado),
      });
      resultados.set(f.escenarioId, lista);
    }
    return resultados;
  }

  private toItem(r: ResultInput): SimulationResultItem {
    return {
      indicatorKey: r.indicatorKey,
      zoneId: r.zoneId,
      baseValue: r.baseValue,
      simulatedValue: r.simulatedValue,
      variationPct:
        r.baseValue !== 0 ? Number((((r.simulatedValue - r.baseValue) / r.baseValue) * 100).toFixed(4)) : null,
    };
  }

  /**
   * El catálogo `indicadores` lo mantiene M09 (Leonardo). Si la clave que
   * necesitamos no existe, avisa exactamente qué falta en vez de fallar
   * con un error de FK genérico.
   */
  private async indicadorIdPorClave(clave: string): Promise<number> {
    const [fila] = await this.dataSource.query(`SELECT id FROM indicadores WHERE clave = $1`, [clave]);
    if (!fila) {
      throw new NotFoundException(
        `El catálogo "indicadores" no tiene la clave "${clave}". Agrégala tú o pídeselo a quien mantiene esa ` +
          `tabla (M09): INSERT INTO indicadores (clave, nombre, descripcion, unidad, ambito) VALUES ` +
          `('${clave}', 'Nombre legible', 'Descripción', 'unidades', 'zona');`,
      );
    }
    return fila.id;
  }

  private async findSegmentId(zoneId: string): Promise<number | null> {
    return (await this.segmentoDeZona(zoneId))?.segmentId ?? null;
  }

  /**
   * Antes llamaba a `ZonesService.findSegmentId` (catalog-service, fuera
   * de este microservicio). Se copia la misma consulta tal cual sobre las
   * tablas compartidas `zona_clasificaciones` / `corrida_clusters` /
   * `segmentos_ingreso`: solo lectura, catalog-service sigue siendo quien
   * las escribe.
   *
   * El ingreso es el del SEGMENTO de la zona, nunca el de una persona, y
   * se estima igual que en `AccessibilityService.ingresoEstimadoDeSegmento`
   * (punto medio; segmento abierto = 1.5x el mínimo como techo).
   */
  private async segmentoDeZona(zoneId: string): Promise<{ segmentId: number; ingresoEstimado: number } | null> {
    const [fila] = await this.dataSource.query(
      `
      SELECT s.id AS "segmentId", s.ingreso_min AS "ingresoMin", s.ingreso_max AS "ingresoMax"
      FROM zona_clasificaciones zc
      LEFT JOIN corrida_clusters cc
            ON cc.corrida_id = zc.corrida_id AND cc.cluster_valor = zc.cluster_valor
      LEFT JOIN segmentos_ingreso s
            ON s.id = COALESCE(zc.segmento_manual_id, cc.segmento_ingreso_id)
      WHERE zc.zona_id = $1 AND zc.vigente
      LIMIT 1
      `,
      [zoneId],
    );
    if (!fila?.segmentId) return null;
    const min = Number(fila.ingresoMin);
    const max = fila.ingresoMax ? Number(fila.ingresoMax) : min * 1.5;
    const ingresoEstimado = (min + max) / 2;
    // Con ingreso 0 no hay porcentaje que calcular: se trata como "sin segmento".
    return ingresoEstimado > 0 ? { segmentId: fila.segmentId, ingresoEstimado } : null;
  }

  private async nombreProducto(productId: string): Promise<string> {
    const [fila] = await this.dataSource.query(`SELECT nombre FROM productos WHERE id = $1`, [productId]);
    if (!fila) throw new NotFoundException(`No existe el producto ${productId}.`);
    return fila.nombre;
  }

  /** `escenarios.zona_id` tiene FK: una zona inexistente llegaba al INSERT y salía como 500. */
  private async verificarZona(zoneId: string): Promise<void> {
    const [fila] = await this.dataSource.query(`SELECT 1 FROM zonas WHERE id = $1`, [zoneId]);
    if (!fila) throw new NotFoundException(`La zona ${zoneId} no existe.`);
  }

  /**
   * Presentaciones a comparar: las pedidas (todas deben ser del producto y
   * estar activas) o, si no se piden, todas las activas del producto.
   */
  private async presentacionesAComparar(
    productId: string,
    productName: string,
    presentationIds?: string[],
  ): Promise<PresentacionProducto[]> {
    const filas: {
      id: string;
      nombre: string;
      activo: boolean;
      predeterminada: boolean;
      contenido: string;
      tipoUnidad: string;
      factorBase: string;
    }[] = await this.dataSource.query(
      `
      SELECT pp.id, pp.nombre, pp.activo, pp.es_predeterminada AS "predeterminada", pp.contenido,
             um.tipo AS "tipoUnidad", um.factor_base AS "factorBase"
      FROM producto_presentaciones pp
      JOIN unidades_medida um ON um.id = pp.unidad_medida_id
      WHERE pp.producto_id = $1
      ORDER BY um.tipo, pp.contenido * um.factor_base, pp.nombre
      `,
      [productId],
    );
    const delProducto: PresentacionProducto[] = filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      activo: f.activo,
      predeterminada: f.predeterminada,
      tipoUnidad: f.tipoUnidad,
      contenidoBase: Number(f.contenido) * Number(f.factorBase),
    }));

    if (!presentationIds) {
      const activas = delProducto.filter((p) => p.activo);
      if (activas.length < PRESENTACIONES_MINIMAS) {
        throw new BadRequestException(
          `El producto "${productName}" tiene ${activas.length} presentación(es) activa(s); se necesitan al menos ` +
            `${PRESENTACIONES_MINIMAS} para comparar.`,
        );
      }
      return activas;
    }

    const pedidas = presentationIds.map((id) => id.toLowerCase());
    const ajenas = pedidas.filter((id) => !delProducto.some((p) => p.id === id));
    if (ajenas.length > 0) {
      throw new BadRequestException(
        `Estas presentaciones no pertenecen al producto "${productName}": ${ajenas.join(', ')}. Solo se comparan ` +
          'presentaciones de un mismo producto.',
      );
    }
    const seleccion = delProducto.filter((p) => pedidas.includes(p.id));
    const inactivas = seleccion.filter((p) => !p.activo);
    if (inactivas.length > 0) {
      throw new BadRequestException(
        `Estas presentaciones de "${productName}" están inactivas y no se pueden comparar: ` +
          `${inactivas.map((p) => `${p.nombre} (${p.id})`).join(', ')}.`,
      );
    }
    return seleccion;
  }

  /**
   * Precio vigente promedio por presentación (en la zona o nacional). La
   * presentación sin precio NO aparece en el mapa: no se sustituye por 0.
   */
  private async preciosVigentes(presentationIds: string[], zoneId: string | null): Promise<Map<string, number>> {
    const filas: { presentationId: string; precio: number }[] = await this.dataSource.query(
      `
      SELECT p.presentacion_id AS "presentationId", AVG(p.precio)::float8 AS "precio"
      FROM precios p JOIN tiendas t ON t.id = p.tienda_id
      WHERE p.presentacion_id = ANY($1::uuid[]) AND p.vigente
        AND ($2::uuid IS NULL OR t.zona_id = $2::uuid)
      GROUP BY p.presentacion_id
      `,
      [presentationIds, zoneId],
    );
    return new Map(filas.map((f) => [f.presentationId, Number(f.precio)]));
  }

  private async demandasHistoricas(presentationIds: string[], zoneId: string | null): Promise<Map<string, number>> {
    const filas: { presentationId: string; cantidad: number }[] = await this.dataSource.query(
      `
      SELECT d.presentacion_id AS "presentationId", SUM(d.cantidad)::float8 AS "cantidad"
      FROM transacciones_detalle d
      JOIN canastas k ON k.transaccion_id = d.transaccion_id
      WHERE d.presentacion_id = ANY($1::uuid[]) AND ($2::uuid IS NULL OR k.zona_id = $2::uuid)
      GROUP BY d.presentacion_id
      `,
      [presentationIds, zoneId],
    );
    return new Map(filas.map((f) => [f.presentationId, Number(f.cantidad)]));
  }

  private async presentacionInfo(presentationId: string) {
    const [fila] = await this.dataSource.query(
      `
      SELECT pp.producto_id AS "productId", p.nombre AS "productName", pp.nombre AS "presentationName"
      FROM producto_presentaciones pp JOIN productos p ON p.id = pp.producto_id
      WHERE pp.id = $1
      `,
      [presentationId],
    );
    if (!fila) throw new NotFoundException(`No existe la presentación ${presentationId}.`);
    return fila;
  }

  private async precioPromedioZona(presentationId: string, zoneId: string): Promise<number> {
    const [fila] = await this.dataSource.query(
      `
      SELECT COALESCE(AVG(p.precio), 0) AS "precio"
      FROM precios p JOIN tiendas t ON t.id = p.tienda_id
      WHERE p.presentacion_id = $1 AND t.zona_id = $2 AND p.vigente
      `,
      [presentationId, zoneId],
    );
    return Number(fila.precio);
  }

  private async demandaHistorica(presentationId: string, zoneId?: string): Promise<number> {
    const [fila] = await this.dataSource.query(
      `
      SELECT COALESCE(SUM(d.cantidad), 0)::float8 AS "cantidad"
      FROM transacciones_detalle d
      JOIN canastas k ON k.transaccion_id = d.transaccion_id
      WHERE d.presentacion_id = $1 AND ($2::uuid IS NULL OR k.zona_id = $2::uuid)
      `,
      [presentationId, zoneId ?? null],
    );
    return Number(fila.cantidad);
  }

  /**
   * Última corrida de elasticidad COMPLETADA para esta presentación:
   * prioriza la de esta zona; si no hay, cae a la nacional (zona_id NULL).
   * Devuelve también la corrida, para que el escenario registre de dónde
   * salió el valor con el que se calculó.
   */
  private async elasticidadDe(
    presentationId: string,
    zoneId: string,
  ): Promise<{ valor: number; corridaId: string; esNacional: boolean }> {
    const [fila] = await this.dataSource.query(
      `
      SELECT e.valor, e.corrida_id AS "corridaId", (e.zona_id IS NULL) AS "esNacional"
      FROM elasticidades e
      JOIN analisis_corridas c ON c.id = e.corrida_id
      WHERE e.presentacion_id = $1 AND (e.zona_id = $2 OR e.zona_id IS NULL)
        AND c.tipo = 'elasticidad' AND c.estado = 'completada'
      ORDER BY (e.zona_id IS NULL), c.ejecutada_en DESC
      LIMIT 1
      `,
      [presentationId, zoneId],
    );
    if (!fila) {
      throw new NotFoundException(
        'No hay elasticidad calculada para esta presentación (ni por zona ni nacional). ' +
          'Corre POST /elasticity/calculate para esta presentación antes de simular el precio.',
      );
    }
    return { valor: Number(fila.valor), corridaId: fila.corridaId, esNacional: fila.esNacional };
  }
}
