import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { ZonaEntity } from '../entities/zona.entity';
import { MunicipioEntity } from '../entities/municipio.entity';
import { CacheService } from '../common/cache/cache.service';
import { LLAVES_CATALOGO, TTL_CATALOGOS_SEGUNDOS } from '../common/cache/catalogos';
import { Pagina } from '../common/dto/pagination.dto';
import { paginar } from '../common/helpers/pagination.helper';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ZoneFilterDto } from './dto/zone-filter.dto';
import { ZoneClassificationDto, ZoneIndicatorsDto } from './dto/zone-indicators.dto';

export interface ZoneComparisonRow {
  zoneId: string;
  zoneName: string;
  municipality: string;
  /** null = todavía no hay ninguna clasificación vigente para esta zona. */
  classification: string | null;
  /** null = el módulo de Analítica todavía no ha calculado este indicador. */
  estimatedIncome: number | null;
  population: number | null;
  availability: number | null;
}

@Injectable()
export class ZonesService {
  constructor(
    @InjectRepository(ZonaEntity)
    private readonly zonasRepo: Repository<ZonaEntity>,
    @InjectRepository(MunicipioEntity)
    private readonly municipiosRepo: Repository<MunicipioEntity>,
    private readonly dataSource: DataSource,
    private readonly cache: CacheService,
  ) {}

  /** Orden fijo por nombre (ver contrato). El municipio viene por la relación eager. */
  findAll(filtros: ZoneFilterDto): Promise<Pagina<ZonaEntity>> {
    const qb = this.zonasRepo
      .createQueryBuilder('z')
      .leftJoinAndSelect('z.municipio', 'm')
      .orderBy('z.nombre', 'ASC')
      .addOrderBy('z.id', 'ASC');
    return paginar(qb, filtros);
  }

  /** Catálogo chico e inmutable: arreglo plano, sin paginar. Cacheado en Redis (ver common/cache/catalogos.ts). */
  findMunicipalities() {
    return this.cache.obtener(LLAVES_CATALOGO.municipios, TTL_CATALOGOS_SEGUNDOS, () =>
      this.municipiosRepo.find({ order: { nombre: 'ASC' } }),
    );
  }

  async findOne(id: string): Promise<ZonaEntity> {
    const zona = await this.zonasRepo.findOne({ where: { id } });
    if (!zona) {
      throw new NotFoundException('La zona no existe.');
    }
    return zona;
  }

  async create(dto: CreateZoneDto): Promise<ZonaEntity> {
    await this.exigirMunicipio(dto.municipioId);
    await this.rechazarDuplicado(dto.nombre, dto.municipioId);

    const zona = this.zonasRepo.create({
      nombre: dto.nombre,
      municipioId: dto.municipioId,
      descripcion: dto.descripcion ?? null,
      activo: true,
    });
    const guardada = await this.zonasRepo.save(zona);
    return this.findOne(guardada.id);
  }

  async update(id: string, dto: UpdateZoneDto): Promise<ZonaEntity> {
    const zona = await this.findOne(id);

    if (dto.municipioId !== undefined) {
      await this.exigirMunicipio(dto.municipioId);
    }
    if (dto.nombre || dto.municipioId !== undefined) {
      await this.rechazarDuplicado(dto.nombre ?? zona.nombre, dto.municipioId ?? zona.municipioId, id);
    }

    // `municipio` (relación eager) se suelta para que TypeORM tome el nuevo
    // `municipioId` en vez de volver a guardar el municipio anterior.
    const { municipio: _municipio, ...base } = zona;
    void _municipio;
    await this.zonasRepo.save({
      ...base,
      ...(dto.nombre !== undefined && { nombre: dto.nombre }),
      ...(dto.municipioId !== undefined && { municipioId: dto.municipioId }),
      ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
      ...(dto.activo !== undefined && { activo: dto.activo }),
    });
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const zona = await this.findOne(id);
    try {
      await this.zonasRepo.remove(zona);
    } catch (err) {
      // 23503 = foreign_key_violation. `tiendas.zona_id` es RESTRICT a
      // propósito (no se puede borrar la zona de una tienda existente).
      if (err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23503') {
        throw new ConflictException(
          'No se puede eliminar: hay tiendas u otros registros asociados a esta zona. Desactívala en vez de borrarla.',
        );
      }
      throw err;
    }
  }

  /**
   * Compara zonas por su clasificación vigente (segmento de ingreso) y
   * sus indicadores más recientes. Ambos son de solo lectura: esta zona
   * no los calcula, los calcula el módulo de Analítica (M09) al correr
   * una `analisis_corridas`; aquí solo se leen si ya existen.
   */
  async compareZones(zoneIds: string[]): Promise<ZoneComparisonRow[]> {
    // Los ids repetidos se deduplican; comparar exige al menos DOS zonas distintas.
    zoneIds = [...new Set(zoneIds)];
    if (zoneIds.length < 2) {
      throw new BadRequestException('Para comparar indica al menos 2 ids de zona distintos (?ids=uuid1,uuid2).');
    }

    const zonasBase = await this.dataSource.query(
      `
      SELECT z.id AS "zoneId", z.nombre AS "zoneName", m.nombre AS "municipality",
             s.nombre AS "classification"
      FROM zonas z
      JOIN municipios m ON m.id = z.municipio_id
      LEFT JOIN zona_clasificaciones zc ON zc.zona_id = z.id AND zc.vigente
      LEFT JOIN corrida_clusters cc
             ON cc.corrida_id = zc.corrida_id AND cc.cluster_valor = zc.cluster_valor
      LEFT JOIN segmentos_ingreso s
             ON s.id = COALESCE(zc.segmento_manual_id, cc.segmento_ingreso_id)
      WHERE z.id = ANY($1::uuid[])
      `,
      [zoneIds],
    );

    const encontradas = new Set(zonasBase.map((z: { zoneId: string }) => z.zoneId));
    const faltantes = zoneIds.filter((id) => !encontradas.has(id));
    if (faltantes.length > 0) {
      throw new NotFoundException(`Estas zonas no existen: ${faltantes.join(', ')}.`);
    }

    // Último valor registrado de cada indicador, por zona. DISTINCT ON
    // se queda con la fila de periodo_fin más reciente por (zona, clave).
    const indicadores: {
      zoneId: string;
      clave: string;
      valor: string;
    }[] = await this.dataSource.query(
      `
      SELECT DISTINCT ON (iv.zona_id, i.clave) iv.zona_id AS "zoneId", i.clave, iv.valor
      FROM indicador_valores iv
      JOIN indicadores i ON i.id = iv.indicador_id
      JOIN analisis_corridas c ON c.id = iv.corrida_id
      WHERE iv.zona_id = ANY($1::uuid[]) AND i.clave IN ('ingreso_estimado', 'poblacion', 'disponibilidad')
      ORDER BY iv.zona_id, i.clave, iv.periodo_fin DESC, c.ejecutada_en DESC
      `,
      [zoneIds],
    );

    const indicadoresPorZona = new Map<string, Record<string, number>>();
    for (const fila of indicadores) {
      const actual = indicadoresPorZona.get(fila.zoneId) ?? {};
      actual[fila.clave] = Number(fila.valor);
      indicadoresPorZona.set(fila.zoneId, actual);
    }

    return zonasBase.map((z: ZoneComparisonRow) => {
      const valores = indicadoresPorZona.get(z.zoneId) ?? {};
      return {
        zoneId: z.zoneId,
        zoneName: z.zoneName,
        municipality: z.municipality,
        classification: z.classification ?? null,
        estimatedIncome: valores.ingreso_estimado ?? null,
        population: valores.poblacion ?? null,
        availability: valores.disponibilidad ?? null,
      };
    });
  }

  /**
   * CAT-13: carga manual de ingreso estimado, población y disponibilidad de una zona.
   * Deja trazabilidad completa en UNA transacción: una corrida `descriptiva` de origen
   * `carga_manual` (quién, cuándo, periodo y fuente) y un valor por indicador ligado a esa corrida.
   * Nunca pisa el historial: una carga nueva con el mismo periodo gana al leer (la más reciente).
   */
  async setIndicators(zoneId: string, dto: ZoneIndicatorsDto, usuarioId: string) {
    await this.findOne(zoneId);
    if (dto.periodoFin < dto.periodoInicio) {
      throw new BadRequestException('periodoFin no puede ser anterior a periodoInicio.');
    }
    const valores: Array<[string, number]> = [
      ['ingreso_estimado', dto.ingresoEstimado],
      ['poblacion', dto.poblacion],
      ['disponibilidad', dto.disponibilidad],
    ];

    return this.dataSource.transaction(async (manager) => {
      const [corrida] = await manager.query(
        `INSERT INTO analisis_corridas (tipo, estado, ejecutada_por, periodo_inicio, periodo_fin)
         VALUES ('descriptiva', 'completada', $1, $2, $3) RETURNING id`,
        [usuarioId, dto.periodoInicio, dto.periodoFin],
      );
      for (const [clave, valor] of [['origen', 'carga_manual'], ['fuente', dto.fuente], ['zona_id', zoneId]]) {
        await manager.query('INSERT INTO analisis_corrida_parametros (corrida_id, clave, valor) VALUES ($1, $2, $3)', [corrida.id, clave, valor]);
      }
      for (const [clave, valor] of valores) {
        const insertado = await manager.query(
          `INSERT INTO indicador_valores (indicador_id, corrida_id, zona_id, periodo_inicio, periodo_fin, valor)
           SELECT i.id, $2, $3, $4, $5, $6 FROM indicadores i WHERE i.clave = $1 RETURNING id`,
          [clave, corrida.id, zoneId, dto.periodoInicio, dto.periodoFin, valor],
        );
        // `INSERT ... SELECT` no falla si el catálogo no trae la clave: se avisa en vez de cargar a medias.
        if (insertado.length === 0) {
          throw new BadRequestException(`El indicador ${clave} no existe en el catálogo.`);
        }
      }
      return {
        zoneId,
        estimatedIncome: dto.ingresoEstimado,
        population: dto.poblacion,
        availability: dto.disponibilidad,
        periodStart: dto.periodoInicio,
        periodEnd: dto.periodoFin,
        source: dto.fuente,
        runId: corrida.id as string,
      };
    });
  }

  /**
   * CAT-13: clasificación MANUAL de una zona en un segmento de ingreso. Cierra la clasificación vigente
   * (le pone fecha de fin, no la borra: queda el historial) y crea la nueva, con quién la asignó (RN-02).
   */
  async setClassification(zoneId: string, dto: ZoneClassificationDto, usuarioId: string) {
    await this.findOne(zoneId);
    const [segmento] = await this.dataSource.query('SELECT id, codigo, nombre FROM segmentos_ingreso WHERE id = $1', [dto.segmentId]);
    if (!segmento) {
      throw new BadRequestException('El segmento indicado no existe.');
    }
    return this.dataSource.transaction(async (manager) => {
      const [previa] = await manager.query(
        'SELECT segmento_manual_id FROM zona_clasificaciones WHERE zona_id = $1 AND vigente_hasta IS NULL LIMIT 1',
        [zoneId],
      );
      await manager.query('UPDATE zona_clasificaciones SET vigente_hasta = CURRENT_DATE WHERE zona_id = $1 AND vigente_hasta IS NULL', [zoneId]);
      const [nueva] = await manager.query(
        `INSERT INTO zona_clasificaciones (zona_id, segmento_manual_id, asignada_por)
         VALUES ($1, $2, $3) RETURNING id, to_char(vigente_desde, 'YYYY-MM-DD') AS desde`,
        [zoneId, dto.segmentId, usuarioId],
      );
      return {
        zoneId,
        segmentId: segmento.id as number,
        segmentCode: segmento.codigo as string,
        segmentName: segmento.nombre as string,
        since: nueva.desde as string,
        previousSegmentId: (previa?.segmento_manual_id as number | null | undefined) ?? null,
      };
    });
  }

  private async exigirMunicipio(municipioId: number) {
    const municipio = await this.municipiosRepo.findOne({ where: { id: municipioId } });
    if (!municipio) {
      throw new BadRequestException('El municipio indicado no existe.');
    }
  }

  private async rechazarDuplicado(nombre: string, municipioId: number, excludeId?: string) {
    const existente = await this.zonasRepo.findOne({ where: { nombre, municipioId } });
    if (existente && existente.id !== excludeId) {
      throw new ConflictException(`Ya existe una zona "${nombre}" en ese municipio.`);
    }
  }
}
