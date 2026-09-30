import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { UsuarioSolicitante } from '../common/roles';
import { Scenario } from '../entities/scenario.entity';
import { ScenarioChange, ScenarioChangeType } from '../entities/scenario-change.entity';
import { ScenarioResult } from '../entities/scenario-result.entity';
import { ZonesService } from '../zones/zones.service';
import { PriceSimulationDto } from './dto/price-simulation.dto';
import { PresentationSimulationDto } from './dto/presentation-simulation.dto';
import { SimulationResult, SimulationResultItem } from './dto/simulation-result.dto';
import { ScenarioComparison, ScenarioComparisonRow } from './dto/scenario-comparison.dto';

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

/** Fecha en el nombre del escenario en formato legible ("28/09/26, 02:15"), no ISO crudo. */
function formatearFecha(fecha: Date): string {
  return fecha.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * M13 — Simulación de escenarios, según Contrato de Métodos y Endpoints.
 * Cada simulación (precio o presentación) se guarda automáticamente como
 * escenario (`escenarios` + `escenario_cambios` + `escenario_resultados`),
 * igual que AssociationService.runApriori guarda vía saveRun (M10): por
 * eso `saveScenario` no tiene endpoint propio, es un método interno.
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
    private readonly zonesService: ZonesService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * `user` no está en la firma del contrato, pero `escenarios.creado_por`
   * es NOT NULL y solo el controlador conoce el JWT (mismo patrón que
   * ElasticityService.calculate en M11).
   */
  async simulatePriceChange(dto: PriceSimulationDto, user: UsuarioSolicitante): Promise<SimulationResult> {
    const info = await this.presentacionInfo(dto.presentationId);
    const precioActual = await this.precioPromedioZona(dto.presentationId, dto.zoneId);
    if (precioActual <= 0) {
      throw new NotFoundException('No hay precio vigente registrado para esa presentación en esa zona.');
    }
    const demandaBase = await this.demandaHistorica(dto.presentationId, dto.zoneId);
    const elasticidad = await this.elasticidadDe(dto.presentationId, dto.zoneId);

    const demandaSimulada = demandaBase * Math.pow(dto.newPrice / precioActual, elasticidad);
    const ingresoBase = demandaBase * precioActual;
    const ingresoSimulado = demandaSimulada * dto.newPrice;
    const segmentId = await this.zonesService.findSegmentId(dto.zoneId);

    const results: ResultInput[] = [
      { indicatorKey: 'demanda_estimada', zoneId: dto.zoneId, baseValue: demandaBase, simulatedValue: demandaSimulada },
      { indicatorKey: 'ingreso_estimado', zoneId: dto.zoneId, baseValue: ingresoBase, simulatedValue: ingresoSimulado },
    ];
    const changes: ChangeInput[] = [
      { presentationId: dto.presentationId, type: 'precio', previousValue: precioActual, newValue: dto.newPrice },
    ];

    const escenario = await this.saveScenario(
      {
        nombre: `Cambio de precio - ${info.productName} ${info.presentationName} (${formatearFecha(new Date())})`,
        zonaId: dto.zoneId,
        changes,
        results,
      },
      user,
    );

    return {
      type: 'price',
      productId: info.productId,
      presentationId: dto.presentationId,
      zoneId: dto.zoneId,
      segmentId,
      inputs: { currentPrice: precioActual, newPrice: dto.newPrice, elasticity: elasticidad },
      results: results.map((r) => this.toItem(r)),
      scenarioId: escenario.id,
    };
  }

  async simulatePresentationChange(
    dto: PresentationSimulationDto,
    user: UsuarioSolicitante,
  ): Promise<SimulationResult> {
    const [infoA, infoB] = await Promise.all([
      this.presentacionDetalle(dto.presentationIdA),
      this.presentacionDetalle(dto.presentationIdB),
    ]);
    const [precioA, precioB] = await Promise.all([
      this.precioVigente(dto.presentationIdA, dto.zoneId),
      this.precioVigente(dto.presentationIdB, dto.zoneId),
    ]);
    const [demandaA, demandaB] = await Promise.all([
      this.demandaHistorica(dto.presentationIdA, dto.zoneId),
      this.demandaHistorica(dto.presentationIdB, dto.zoneId),
    ]);

    const results: ResultInput[] = [
      { indicatorKey: 'desembolso', zoneId: dto.zoneId ?? null, baseValue: precioA, simulatedValue: precioB },
    ];

    const mismaUnidad = infoA.tipoUnidad === infoB.tipoUnidad;
    let note: string | undefined;
    if (mismaUnidad) {
      const unitarioA = precioA / (Number(infoA.contenido) * infoA.factorBase);
      const unitarioB = precioB / (Number(infoB.contenido) * infoB.factorBase);
      results.push({
        indicatorKey: 'precio_unitario',
        zoneId: dto.zoneId ?? null,
        baseValue: unitarioA,
        simulatedValue: unitarioB,
      });
    } else {
      note = 'Las presentaciones usan unidades de medida distintas (masa vs volumen, etc.): no se compara precio unitario.';
    }
    results.push({
      indicatorKey: 'demanda_historica',
      zoneId: dto.zoneId ?? null,
      baseValue: demandaA,
      simulatedValue: demandaB,
    });

    const changes: ChangeInput[] = [
      { presentationId: dto.presentationIdA, type: 'empaque', previousValue: null, newValue: 0 },
      { presentationId: dto.presentationIdB, type: 'empaque', previousValue: null, newValue: 1 },
    ];

    const escenario = await this.saveScenario(
      {
        nombre: `Comparación de presentaciones - ${formatearFecha(new Date())}`,
        zonaId: dto.zoneId ?? null,
        changes,
        results,
      },
      user,
    );

    const segmentId = dto.zoneId ? await this.zonesService.findSegmentId(dto.zoneId) : null;

    return {
      type: 'presentation',
      productId: infoA.productoId,
      presentationId: dto.presentationIdA,
      zoneId: dto.zoneId ?? null,
      segmentId,
      inputs: { presentationIdA: dto.presentationIdA, presentationIdB: dto.presentationIdB },
      results: results.map((r) => this.toItem(r)),
      scenarioId: escenario.id,
      note,
    };
  }

  async findAllScenarios(): Promise<Scenario[]> {
    return this.scenarioRepo.find({ order: { createdAt: 'DESC' } });
  }

  async compareScenarios(scenarioIds: string[]): Promise<ScenarioComparison> {
    if (scenarioIds.length < 2) {
      throw new BadRequestException('Indica al menos dos ids de escenario (?ids=1,2).');
    }
    const escenarios = await this.scenarioRepo.findBy({ id: In(scenarioIds) });
    if (escenarios.length === 0) {
      throw new NotFoundException('Ninguno de los escenarios indicados existe.');
    }

    const filas: { escenarioId: string; indicatorKey: string; zoneId: string | null; valorSimulado: string }[] =
      await this.dataSource.query(
        `
        SELECT r.escenario_id AS "escenarioId", i.clave AS "indicatorKey", r.zona_id AS "zoneId",
               r.valor_simulado AS "valorSimulado"
        FROM escenario_resultados r
        JOIN indicadores i ON i.id = r.indicador_id
        WHERE r.escenario_id = ANY($1::uuid[])
        `,
        [scenarioIds],
      );

    const rowsMap = new Map<string, ScenarioComparisonRow>();
    for (const f of filas) {
      const key = `${f.indicatorKey}::${f.zoneId ?? ''}`;
      const row = rowsMap.get(key) ?? { indicatorKey: f.indicatorKey, zoneId: f.zoneId, valuesByScenario: {} };
      row.valuesByScenario[f.escenarioId] = Number(f.valorSimulado);
      rowsMap.set(key, row);
    }

    return {
      scenarioIds,
      scenarioNames: Object.fromEntries(escenarios.map((e) => [e.id, e.nombre])),
      rows: [...rowsMap.values()],
    };
  }

  /**
   * Persiste escenario + cambios + resultados en una sola transacción. Sin
   * endpoint propio (igual que AssociationService.saveRun): la llaman
   * internamente simulatePriceChange y simulatePresentationChange.
   */
  private async saveScenario(
    input: { nombre: string; zonaId: string | null; changes: ChangeInput[]; results: ResultInput[] },
    user: UsuarioSolicitante,
  ): Promise<Scenario> {
    return this.dataSource.transaction(async (manager) => {
      const escenario = await manager.save(
        manager.create(Scenario, {
          nombre: input.nombre,
          descripcion: null,
          escenarioBaseId: null,
          corridaId: null,
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

  private async presentacionDetalle(presentationId: string) {
    const [fila] = await this.dataSource.query(
      `
      SELECT pp.producto_id AS "productoId", pp.contenido, um.tipo AS "tipoUnidad", um.factor_base AS "factorBase"
      FROM producto_presentaciones pp
      JOIN unidades_medida um ON um.id = pp.unidad_medida_id
      WHERE pp.id = $1
      `,
      [presentationId],
    );
    if (!fila) throw new NotFoundException(`No existe la presentación ${presentationId}.`);
    return {
      productoId: fila.productoId,
      contenido: fila.contenido,
      tipoUnidad: fila.tipoUnidad,
      factorBase: Number(fila.factorBase),
    };
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

  private async precioVigente(presentationId: string, zoneId?: string): Promise<number> {
    if (zoneId) return this.precioPromedioZona(presentationId, zoneId);
    const [fila] = await this.dataSource.query(
      `SELECT COALESCE(AVG(precio), 0) AS "precio" FROM precios WHERE presentacion_id = $1 AND vigente`,
      [presentationId],
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
   */
  private async elasticidadDe(presentationId: string, zoneId: string): Promise<number> {
    const [fila] = await this.dataSource.query(
      `
      SELECT e.valor
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
    return Number(fila.valor);
  }
}
