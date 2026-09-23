import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { ZonaEntity } from '../entities/zona.entity';
import { MunicipioEntity } from '../entities/municipio.entity';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

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
  ) {}

  findZonas() {
    return this.zonasRepo.find({ order: { nombre: 'ASC' } });
  }

  findMunicipios() {
    return this.municipiosRepo.find({ order: { nombre: 'ASC' } });
  }

  async findOne(id: string): Promise<ZonaEntity> {
    const zona = await this.zonasRepo.findOne({ where: { id } });
    if (!zona) {
      throw new NotFoundException('La zona no existe.');
    }
    return zona;
  }

  async create(dto: CreateZoneDto): Promise<ZonaEntity> {
    const municipio = await this.municipiosRepo.findOne({ where: { id: dto.municipioId } });
    if (!municipio) {
      throw new BadRequestException('El municipio indicado no existe.');
    }

    await this.rechazarDuplicado(dto.nombre, dto.municipioId);

    const zona = this.zonasRepo.create({
      nombre: dto.nombre,
      municipioId: dto.municipioId,
      descripcion: dto.descripcion ?? null,
      activo: true,
    });
    return this.zonasRepo.save(zona);
  }

  async update(id: string, dto: UpdateZoneDto): Promise<ZonaEntity> {
    const zona = await this.findOne(id);

    if (dto.municipioId !== undefined) {
      const municipio = await this.municipiosRepo.findOne({ where: { id: dto.municipioId } });
      if (!municipio) {
        throw new BadRequestException('El municipio indicado no existe.');
      }
    }

    if (dto.nombre || dto.municipioId !== undefined) {
      await this.rechazarDuplicado(dto.nombre ?? zona.nombre, dto.municipioId ?? zona.municipioId, id);
    }

    Object.assign(zona, {
      ...(dto.nombre !== undefined && { nombre: dto.nombre }),
      ...(dto.municipioId !== undefined && { municipioId: dto.municipioId }),
      ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
      ...(dto.activo !== undefined && { activo: dto.activo }),
    });
    return this.zonasRepo.save(zona);
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
    if (zoneIds.length === 0) {
      throw new BadRequestException('Indica al menos un id de zona (?ids=1,2,3).');
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

    if (zonasBase.length === 0) {
      throw new NotFoundException('Ninguna de las zonas indicadas existe.');
    }

    // Último valor registrado de cada indicador, por zona. DISTINCT ON
    // se queda con la fila de periodo_fin más reciente por (zona, clave).
    const indicadores: {
      zoneId: string;
      clave: string;
      valor: string;
    }[] = await this.dataSource.query(
      `
      SELECT DISTINCT ON (zona_id, clave) zona_id AS "zoneId", clave, valor
      FROM v_zona_indicadores
      WHERE zona_id = ANY($1::uuid[]) AND clave IN ('ingreso_estimado', 'poblacion', 'disponibilidad')
      ORDER BY zona_id, clave, periodo_fin DESC
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

  private async rechazarDuplicado(nombre: string, municipioId: number, excludeId?: string) {
    const existente = await this.zonasRepo.findOne({ where: { nombre, municipioId } });
    if (existente && existente.id !== excludeId) {
      throw new ConflictException(`Ya existe una zona "${nombre}" en ese municipio.`);
    }
  }
}
