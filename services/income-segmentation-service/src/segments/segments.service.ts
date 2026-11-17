import { ConflictException, Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { Pagina } from '../common/dto/pagination.dto';
import { armarPagina, limites } from '../common/dto/pagina.dto';
import { CreateSegmentDto, SegmentFilterDto, UpdateSegmentDto } from './dto/segment.dto';
import { aplicarCambios, decimal, Rango, validarRango, ValoresSegmento } from './segmentos';

/** Segmento en su versión vigente. El orden de los campos es el del XSD. */
export interface Segment {
  id: number;
  code: string;
  name: string;
  incomeRangeMin: string;
  incomeRangeMax: string | null;
  source: string;
  updateFrequency: string;
  zoneRelation: string;
  limitations: string;
  description: string | null;
  version: number;
  versionValidFrom: Date;
}

/** Una versión del segmento (D-35). El orden de los campos es el del XSD. */
export interface SegmentVersion {
  segmentId: number;
  version: number;
  name: string;
  incomeRangeMin: string;
  incomeRangeMax: string | null;
  source: string;
  updateFrequency: string;
  zoneRelation: string;
  limitations: string;
  description: string | null;
  validFrom: Date;
  validTo: Date | null;
  current: boolean;
  createdBy: string | null;
  changeReason: string | null;
}

export type CambioAuditado = { campo: string; previo: string | null; posterior: string | null };

const SELECT_SEGMENTO = `
  SELECT s.id, s.codigo, s.nombre, s.ingreso_min, s.ingreso_max, s.fuente,
         s.frecuencia_actualizacion, s.relacion_zona, s.limitaciones, s.descripcion,
         s.version_actual, COALESCE(v.vigente_desde, now()) AS vigente_desde
  FROM segmentos_ingreso s
  LEFT JOIN segmento_versiones v ON v.segmento_id = s.id AND v.version = s.version_actual`;

const SELECT_VERSION = `
  SELECT v.segmento_id, v.version, v.nombre, v.ingreso_min, v.ingreso_max, v.fuente,
         v.frecuencia_actualizacion, v.relacion_zona, v.limitaciones, v.descripcion,
         v.vigente_desde, v.vigente_hasta, v.creado_por, v.motivo_cambio
  FROM segmento_versiones v`;

/**
 * Un segmento que todavía no tiene fila en `segmento_versiones` (venía de
 * catalog-service, o se creó allá durante la transición de D-35) recibe su
 * versión 1 con los valores que tiene hoy. Es idempotente.
 */
const SEMBRAR_VERSIONES = `
  INSERT INTO segmento_versiones
    (segmento_id, version, nombre, ingreso_min, ingreso_max, fuente,
     frecuencia_actualizacion, relacion_zona, limitaciones, descripcion)
  SELECT s.id, s.version_actual, s.nombre, s.ingreso_min, s.ingreso_max, s.fuente,
         s.frecuencia_actualizacion, s.relacion_zona, s.limitaciones, s.descripcion
  FROM segmentos_ingreso s
  WHERE NOT EXISTS (
    SELECT 1 FROM segmento_versiones v WHERE v.segmento_id = s.id AND v.version = s.version_actual
  )`;

type Fila = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function aSegment(f: Fila): Segment {
  return {
    id: Number(f.id),
    code: f.codigo,
    name: f.nombre,
    incomeRangeMin: f.ingreso_min,
    incomeRangeMax: f.ingreso_max,
    source: f.fuente,
    updateFrequency: f.frecuencia_actualizacion,
    zoneRelation: f.relacion_zona,
    limitations: f.limitaciones,
    description: f.descripcion,
    version: Number(f.version_actual),
    versionValidFrom: f.vigente_desde,
  };
}

function aVersion(f: Fila): SegmentVersion {
  return {
    segmentId: Number(f.segmento_id),
    version: Number(f.version),
    name: f.nombre,
    incomeRangeMin: f.ingreso_min,
    incomeRangeMax: f.ingreso_max,
    source: f.fuente,
    updateFrequency: f.frecuencia_actualizacion,
    zoneRelation: f.relacion_zona,
    limitations: f.limitaciones,
    description: f.descripcion,
    validFrom: f.vigente_desde,
    validTo: f.vigente_hasta,
    current: f.vigente_hasta === null,
    createdBy: f.creado_por,
    changeReason: f.motivo_cambio,
  };
}

function codigoPg(error: unknown): string | undefined {
  return error instanceof QueryFailedError ? (error as unknown as { code?: string }).code : undefined;
}

/**
 * Segmentos de ingreso versionados (D-35). `segmentos_ingreso` guarda la
 * identidad y los valores VIGENTES (así quien ya leía esa tabla no cambia);
 * `segmento_versiones` guarda cada versión y solo se anexa.
 *
 * Un segmento clasifica ZONAS agregadas, nunca personas (RN-02).
 */
@Injectable()
export class SegmentsService implements OnModuleInit {
  private readonly logger = new Logger(SegmentsService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Al arrancar se da versión 1 a lo que venía de catalog. Si la base no está lista, no tumba el arranque. */
  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(SEMBRAR_VERSIONES);
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudieron sembrar las versiones iniciales: ${motivo}`);
    }
  }

  /** Orden fijo: ingreso mínimo ascendente (los segmentos se leen de menor a mayor). */
  async findAll(filtros: SegmentFilterDto): Promise<Pagina<Segment>> {
    const { page, limit, offset } = limites(filtros);
    const [filas, [{ total }]] = await Promise.all([
      this.dataSource.query(`${SELECT_SEGMENTO} ORDER BY s.ingreso_min ASC, s.id ASC LIMIT $1 OFFSET $2`, [limit, offset]),
      this.dataSource.query('SELECT COUNT(*)::int AS total FROM segmentos_ingreso'),
    ]);
    return armarPagina(filas.map(aSegment), total, page, limit);
  }

  async findOne(id: number, manager: EntityManager = this.dataSource.manager): Promise<Segment> {
    // Fuera del rango de SMALLINT no puede existir (y Postgres respondería error, no vacío).
    const [fila] = id >= 1 && id <= 32767 ? await manager.query(`${SELECT_SEGMENTO} WHERE s.id = $1`, [id]) : [];
    if (!fila) throw new NotFoundException(`No existe el segmento de ingreso ${id}.`);
    return aSegment(fila);
  }

  async findVersions(id: number, filtros: SegmentFilterDto): Promise<Pagina<SegmentVersion>> {
    await this.findOne(id);
    const { page, limit, offset } = limites(filtros);
    const [filas, [{ total }]] = await Promise.all([
      this.dataSource.query(`${SELECT_VERSION} WHERE v.segmento_id = $1 ORDER BY v.version DESC LIMIT $2 OFFSET $3`, [id, limit, offset]),
      this.dataSource.query('SELECT COUNT(*)::int AS total FROM segmento_versiones WHERE segmento_id = $1', [id]),
    ]);
    return armarPagina(filas.map(aVersion), total, page, limit);
  }

  async findVersion(id: number, version: number): Promise<SegmentVersion> {
    await this.findOne(id);
    const [fila] =
      version >= 1 && version <= 2147483647
        ? await this.dataSource.query(`${SELECT_VERSION} WHERE v.segmento_id = $1 AND v.version = $2`, [id, version])
        : [];
    if (!fila) throw new NotFoundException(`El segmento ${id} no tiene la versión ${version}.`);
    return aVersion(fila);
  }

  /** Crea el segmento en su versión 1. */
  async create(dto: CreateSegmentDto, usuarioId: string): Promise<Segment> {
    return this.enTransaccion(async (manager) => {
      await this.rechazarDuplicado(manager, { code: dto.code, name: dto.name });
      const max = dto.incomeRangeMax ?? null;
      validarRango(dto.incomeRangeMin, max, await this.rangosVigentes(manager));

      const [{ id }] = await manager.query(
        `INSERT INTO segmentos_ingreso
           (codigo, nombre, ingreso_min, ingreso_max, fuente, frecuencia_actualizacion,
            relacion_zona, limitaciones, descripcion, version_actual)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
         RETURNING id`,
        [dto.code, dto.name, decimal(dto.incomeRangeMin), max === null ? null : decimal(max), dto.source,
         dto.updateFrequency, dto.zoneRelation, dto.limitations, dto.description ?? null],
      );
      await this.anexarVersion(manager, id, 1, {
        name: dto.name,
        incomeRangeMin: decimal(dto.incomeRangeMin),
        incomeRangeMax: max === null ? null : decimal(max),
        source: dto.source,
        updateFrequency: dto.updateFrequency,
        zoneRelation: dto.zoneRelation,
        limitations: dto.limitations,
        description: dto.description ?? null,
      }, usuarioId, null);
      return this.findOne(id, manager);
    });
  }

  /**
   * D-35: editar crea la versión n + 1. La vigente se cierra, la nueva se
   * anexa y `segmentos_ingreso` pasa a mostrarla. Si nada cambia de verdad,
   * no se crea versión (`cambios` vacío).
   */
  async update(
    id: number,
    dto: UpdateSegmentDto,
    usuarioId: string,
  ): Promise<{ segment: Segment; cambios: CambioAuditado[] }> {
    return this.enTransaccion(async (manager) => {
      const actual = await this.findOne(id, manager);
      const vigente: ValoresSegmento = {
        name: actual.name,
        incomeRangeMin: actual.incomeRangeMin,
        incomeRangeMax: actual.incomeRangeMax,
        source: actual.source,
        updateFrequency: actual.updateFrequency,
        zoneRelation: actual.zoneRelation,
        limitations: actual.limitations,
        description: actual.description,
      };
      const { changeReason, ...cambiosPedidos } = dto;
      const { valores, cambios } = aplicarCambios(vigente, cambiosPedidos);
      if (cambios.length === 0) return { segment: actual, cambios };

      if (valores.name !== vigente.name) await this.rechazarDuplicado(manager, { name: valores.name }, id);
      validarRango(
        Number(valores.incomeRangeMin),
        valores.incomeRangeMax === null ? null : Number(valores.incomeRangeMax),
        (await this.rangosVigentes(manager)).filter((rango) => rango.code !== actual.code),
      );

      const nueva = actual.version + 1;
      await manager.query(
        'UPDATE segmento_versiones SET vigente_hasta = now() WHERE segmento_id = $1 AND vigente_hasta IS NULL',
        [id],
      );
      await this.anexarVersion(manager, id, nueva, valores, usuarioId, changeReason ?? null);
      await manager.query(
        `UPDATE segmentos_ingreso
            SET nombre = $2, ingreso_min = $3, ingreso_max = $4, fuente = $5,
                frecuencia_actualizacion = $6, relacion_zona = $7, limitaciones = $8,
                descripcion = $9, version_actual = $10
          WHERE id = $1`,
        [id, valores.name, valores.incomeRangeMin, valores.incomeRangeMax, valores.source,
         valores.updateFrequency, valores.zoneRelation, valores.limitations, valores.description, nueva],
      );
      const segment = await this.findOne(id, manager);
      return {
        segment,
        cambios: [...cambios, { campo: 'version_actual', previo: String(actual.version), posterior: String(nueva) }],
      };
    });
  }

  /** Solo se borra un segmento sin historial: si alguna zona está o estuvo clasificada con él → 409. */
  async remove(id: number): Promise<Segment> {
    const segment = await this.findOne(id);
    try {
      await this.dataSource.query('DELETE FROM segmentos_ingreso WHERE id = $1', [id]);
    } catch (error) {
      // 23503 = foreign_key_violation: una clasificación, canasta o indicador apunta al segmento.
      if (codigoPg(error) === '23503') {
        throw new ConflictException(
          'No se puede eliminar: hay zonas que están o estuvieron clasificadas con este segmento, o análisis que lo usan. El historial no se borra.',
        );
      }
      throw error;
    }
    return segment;
  }

  /**
   * Las escrituras van una por una (`LOCK ... SHARE ROW EXCLUSIVE`): dos
   * altas simultáneas con rangos encimados pasarían las dos la validación si
   * cada una leyera la tabla antes de que la otra escribiera. Las lecturas
   * no se bloquean.
   */
  private async enTransaccion<T>(trabajo: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.query('LOCK TABLE segmentos_ingreso IN SHARE ROW EXCLUSIVE MODE');
        await manager.query(SEMBRAR_VERSIONES);
        return trabajo(manager);
      });
    } catch (error) {
      // 23505 = unique_violation que se escapó a `rechazarDuplicado`.
      if (codigoPg(error) === '23505') {
        throw new ConflictException('Ya existe un segmento con ese código o ese nombre.');
      }
      throw error;
    }
  }

  private async rangosVigentes(manager: EntityManager): Promise<Rango[]> {
    const filas: Fila[] = await manager.query('SELECT codigo, ingreso_min, ingreso_max FROM segmentos_ingreso');
    return filas.map((f) => ({
      code: f.codigo,
      min: Number(f.ingreso_min),
      max: f.ingreso_max === null ? null : Number(f.ingreso_max),
    }));
  }

  private async anexarVersion(
    manager: EntityManager,
    segmentoId: number,
    version: number,
    valores: ValoresSegmento,
    usuarioId: string,
    motivo: string | null,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO segmento_versiones
         (segmento_id, version, nombre, ingreso_min, ingreso_max, fuente, frecuencia_actualizacion,
          relacion_zona, limitaciones, descripcion, creado_por, motivo_cambio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [segmentoId, version, valores.name, valores.incomeRangeMin, valores.incomeRangeMax, valores.source,
       valores.updateFrequency, valores.zoneRelation, valores.limitations, valores.description, usuarioId, motivo],
    );
  }

  /** `code` y `name` son únicos: se revisa antes para responder un 409 que diga cuál choca. */
  private async rechazarDuplicado(
    manager: EntityManager,
    valores: { code?: string; name?: string },
    excluirId?: number,
  ): Promise<void> {
    if (valores.code) {
      const [fila] = await manager.query('SELECT id FROM segmentos_ingreso WHERE codigo = $1', [valores.code]);
      if (fila && Number(fila.id) !== excluirId) {
        throw new ConflictException(`Ya existe un segmento con el código ${valores.code}.`);
      }
    }
    if (valores.name) {
      const [fila] = await manager.query('SELECT id FROM segmentos_ingreso WHERE nombre = $1', [valores.name]);
      if (fila && Number(fila.id) !== excluirId) {
        throw new ConflictException(`Ya existe un segmento con el nombre "${valores.name}".`);
      }
    }
  }
}
