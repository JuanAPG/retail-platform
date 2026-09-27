import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AccessibilityZoneEntity } from '../entities/accessibility-zone.entity';
import {
  ACCESSIBILITY_COMPONENTS,
  AccessibilityComponentType,
  AccessibilityWeightEntity,
} from '../entities/accessibility-weight.entity';
import { AccessibilityComponentEntity } from '../entities/accessibility-component.entity';
import { IncomeSegment } from '../entities/income-segment.entity';
import { ZonesService } from '../zones/zones.service';

/** Forma pública que exige el contrato (M12). No es una entidad: se arma. */
export interface AccessibilityIndex {
  zoneId: string;
  segmentId: number;
  basicBasketCost: number;
  estimatedIncome: number | null;
  indexValue: number;
  /** Extra, no exigido por el contrato: para ver la evolución en el tiempo. */
  calculatedAt?: Date;
}

const PESO_IGUAL = 0.25;

function clamp01(valor: number): number {
  if (Number.isNaN(valor)) return 0;
  return Math.min(1, Math.max(0, valor));
}

@Injectable()
export class AccessibilityService {
  constructor(
    @InjectRepository(AccessibilityZoneEntity)
    private readonly zonaRepo: Repository<AccessibilityZoneEntity>,
    @InjectRepository(AccessibilityWeightEntity)
    private readonly pesosRepo: Repository<AccessibilityWeightEntity>,
    @InjectRepository(AccessibilityComponentEntity)
    private readonly componentesRepo: Repository<AccessibilityComponentEntity>,
    @InjectRepository(IncomeSegment)
    private readonly segmentosRepo: Repository<IncomeSegment>,
    private readonly zonesService: ZonesService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Calcula el índice de accesibilidad de una zona AHORA MISMO y crea una
   * corrida nueva (`analisis_corridas`) cada vez que se llama: así se
   * puede ver cómo se mueve el número en el tiempo, en vez de pisar el
   * resultado anterior.
   */
  async calculateIndex(zoneId: string, segmentId: string): Promise<AccessibilityIndex> {
    const segmento = await this.segmentosRepo.findOne({ where: { id: Number(segmentId) } });
    if (!segmento) {
      throw new NotFoundException('El segmento de ingreso indicado no existe.');
    }

    const [basicBasketCost, avgBasicBasketCostTodas, estimatedIncome, maxIncome, availability, maxAvailability, coverage] =
      await Promise.all([
        this.costoCanastaBasica(zoneId),
        this.costoCanastaBasicaPromedioTodasZonas(),
        this.ingresoEstimadoDeSegmento(segmento),
        this.ingresoMaximoCatalogo(),
        this.disponibilidad(zoneId),
        this.disponibilidadMaxima(),
        this.coberturaBasicos(zoneId),
      ]);

    const valores: Record<AccessibilityComponentType, number> = {
      precio: avgBasicBasketCostTodas > 0 ? clamp01(1 - basicBasketCost / avgBasicBasketCostTodas) : 0,
      ingreso_segmento: maxIncome > 0 ? clamp01((estimatedIncome ?? 0) / maxIncome) : 0,
      disponibilidad: maxAvailability > 0 ? clamp01(availability / maxAvailability) : 0,
      cobertura_basicos: clamp01(coverage),
    };

    const indice = clamp01(
      ACCESSIBILITY_COMPONENTS.reduce((suma, comp) => suma + valores[comp] * PESO_IGUAL, 0),
    );

    const corridaId = await this.crearCorrida(segmento.id, basicBasketCost, estimatedIncome);

    const zonaGuardada = await this.zonaRepo.save(
      this.zonaRepo.create({ corridaId, zonaId: zoneId, indice: indice.toFixed(4) }),
    );

    await this.pesosRepo.save(
      ACCESSIBILITY_COMPONENTS.map((componente) =>
        this.pesosRepo.create({ corridaId, componente, peso: PESO_IGUAL.toFixed(4) }),
      ),
    );

    await this.componentesRepo.save(
      ACCESSIBILITY_COMPONENTS.map((componente) =>
        this.componentesRepo.create({
          accesibilidadId: zonaGuardada.id,
          componente,
          valor: valores[componente].toFixed(4),
        }),
      ),
    );

    return {
      zoneId,
      segmentId: segmento.id,
      basicBasketCost,
      estimatedIncome,
      indexValue: indice,
    };
  }

  /**
   * Historial real de corridas de una zona. `segmentId`, `basicBasketCost`
   * y `estimatedIncome` se leen de `analisis_corrida_parametros` (guardados
   * en `calculateIndex`), no se recalculan: por eso sí reflejan lo que
   * pasaste en cada llamada, no el valor actual.
   */
  async findByZone(zoneId: string): Promise<AccessibilityIndex[]> {
    const filas: {
      corridaId: string;
      indice: string;
      executedAt: Date;
      segmentId: string | null;
      basicBasketCost: string | null;
      estimatedIncome: string | null;
    }[] = await this.dataSource.query(
      `
      SELECT az.corrida_id AS "corridaId", az.indice, ac.ejecutada_en AS "executedAt",
             MAX(CASE WHEN p.clave = 'segmentId' THEN p.valor END) AS "segmentId",
             MAX(CASE WHEN p.clave = 'basicBasketCost' THEN p.valor END) AS "basicBasketCost",
             MAX(CASE WHEN p.clave = 'estimatedIncome' THEN p.valor END) AS "estimatedIncome"
      FROM accesibilidad_zona az
      JOIN analisis_corridas ac ON ac.id = az.corrida_id
      LEFT JOIN analisis_corrida_parametros p ON p.corrida_id = az.corrida_id
      WHERE az.zona_id = $1
      GROUP BY az.corrida_id, az.indice, ac.ejecutada_en
      ORDER BY ac.ejecutada_en DESC
      `,
      [zoneId],
    );

    return filas.map((f) => ({
      zoneId,
      segmentId: f.segmentId ? Number(f.segmentId) : 0,
      basicBasketCost: f.basicBasketCost ? Number(f.basicBasketCost) : 0,
      estimatedIncome: f.estimatedIncome ? Number(f.estimatedIncome) : null,
      indexValue: Number(f.indice),
      calculatedAt: f.executedAt,
    }));
  }

  private async crearCorrida(
    segmentId: number,
    basicBasketCost: number,
    estimatedIncome: number | null,
  ): Promise<string> {
    const hoy = new Date();
    const hace30Dias = new Date();
    hace30Dias.setDate(hoy.getDate() - 30);

    const [fila] = await this.dataSource.query(
      `
      INSERT INTO analisis_corridas (tipo, estado, periodo_inicio, periodo_fin)
      VALUES ('accesibilidad', 'completada', $1, $2)
      RETURNING id
      `,
      [hace30Dias, hoy],
    );
    const corridaId = fila.id;

    await this.dataSource.query(
      `
      INSERT INTO analisis_corrida_parametros (corrida_id, clave, valor)
      VALUES ($1, 'segmentId', $2), ($1, 'basicBasketCost', $3), ($1, 'estimatedIncome', $4)
      `,
      [corridaId, String(segmentId), String(basicBasketCost), estimatedIncome === null ? '' : String(estimatedIncome)],
    );

    return corridaId;
  }

  private async costoCanastaBasica(zoneId: string): Promise<number> {
    const [fila] = await this.dataSource.query(
      `
      SELECT COALESCE(AVG(p.precio), 0) AS "costo"
      FROM precios p
      JOIN producto_presentaciones pp ON pp.id = p.presentacion_id
      JOIN productos prod ON prod.id = pp.producto_id
      JOIN tiendas t ON t.id = p.tienda_id
      WHERE prod.es_canasta_basica = true AND t.zona_id = $1 AND p.vigente
      `,
      [zoneId],
    );
    return Number(fila.costo);
  }

  private async costoCanastaBasicaPromedioTodasZonas(): Promise<number> {
    const [fila] = await this.dataSource.query(
      `
      SELECT COALESCE(AVG(p.precio), 0) AS "costo"
      FROM precios p
      JOIN producto_presentaciones pp ON pp.id = p.presentacion_id
      JOIN productos prod ON prod.id = pp.producto_id
      WHERE prod.es_canasta_basica = true AND p.vigente
      `,
    );
    return Number(fila.costo);
  }

  private ingresoEstimadoDeSegmento(segmento: IncomeSegment): number {
    const min = Number(segmento.incomeRangeMin);
    // Segmento abierto (sin ingreso_max, ej. "más de $50,000"): se estima
    // como 1.5x el mínimo, ya que no hay techo real que promediar.
    const max = segmento.incomeRangeMax ? Number(segmento.incomeRangeMax) : min * 1.5;
    return (min + max) / 2;
  }

  private async ingresoMaximoCatalogo(): Promise<number> {
    const [fila] = await this.dataSource.query(
      `SELECT MAX(COALESCE(ingreso_max, ingreso_min)) AS "maxIngreso" FROM segmentos_ingreso`,
    );
    return Number(fila.maxIngreso ?? 0);
  }

  private async disponibilidad(zoneId: string): Promise<number> {
    const [comparacion] = await this.zonesService.compareZones([zoneId]);
    return comparacion?.availability ?? 0;
  }

  private async disponibilidadMaxima(): Promise<number> {
    const [fila] = await this.dataSource.query(
      `
      SELECT MAX(iv.valor) AS "maxDisponibilidad"
      FROM indicador_valores iv
      JOIN indicadores i ON i.id = iv.indicador_id
      WHERE i.clave = 'disponibilidad'
      `,
    );
    return Number(fila.maxDisponibilidad ?? 0);
  }

  private async coberturaBasicos(zoneId: string): Promise<number> {
    const [{ total }] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM productos WHERE es_canasta_basica = true`,
    );
    const [{ disponibles }] = await this.dataSource.query(
      `
      SELECT COUNT(DISTINCT prod.id) AS disponibles
      FROM productos prod
      JOIN producto_presentaciones pp ON pp.producto_id = prod.id
      JOIN inventario inv ON inv.presentacion_id = pp.id
      JOIN tiendas t ON t.id = inv.tienda_id
      WHERE prod.es_canasta_basica = true AND t.zona_id = $1 AND inv.stock_disponible > 0
      `,
      [zoneId],
    );
    return Number(total) > 0 ? Number(disponibles) / Number(total) : 0;
  }
}