import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { IncomeSegment } from '../entities/income-segment.entity';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';

@Injectable()
export class SegmentsService {
  constructor(
    @InjectRepository(IncomeSegment)
    private readonly segmentsRepo: Repository<IncomeSegment>,
  ) {}

  async create(dto: CreateSegmentDto): Promise<IncomeSegment> {
    await this.rechazarDuplicado(dto.code, dto.name);

    const segment = this.segmentsRepo.create({
      code: dto.code,
      name: dto.name,
      incomeRangeMin: String(dto.incomeRangeMin),
      incomeRangeMax: dto.incomeRangeMax != null ? String(dto.incomeRangeMax) : null,
      source: dto.source,
      updateFrequency: dto.updateFrequency,
      zoneRelation: dto.zoneRelation,
      limitations: dto.limitations,
      description: dto.description ?? null,
    });

    return this.segmentsRepo.save(segment);
  }

  findAll(): Promise<IncomeSegment[]> {
    return this.segmentsRepo.find({ order: { incomeRangeMin: 'ASC' } });
  }

  async findOne(id: number): Promise<IncomeSegment> {
    const segment = await this.segmentsRepo.findOne({ where: { id } });
    if (!segment) {
      throw new NotFoundException(`No existe el segmento de ingreso ${id}.`);
    }
    return segment;
  }

  async update(id: number, dto: UpdateSegmentDto): Promise<IncomeSegment> {
    const segment = await this.findOne(id);

    if (dto.code || dto.name) {
      await this.rechazarDuplicado(dto.code, dto.name, id);
    }

    Object.assign(segment, {
      ...dto,
      incomeRangeMin:
        dto.incomeRangeMin != null ? String(dto.incomeRangeMin) : segment.incomeRangeMin,
      incomeRangeMax:
        dto.incomeRangeMax !== undefined
          ? dto.incomeRangeMax != null
            ? String(dto.incomeRangeMax)
            : null
          : segment.incomeRangeMax,
    });

    return this.segmentsRepo.save(segment);
  }

  async remove(id: number): Promise<void> {
    const segment = await this.findOne(id);

    try {
      await this.segmentsRepo.remove(segment);
    } catch (err) {
      // 23503 = foreign_key_violation. Alguna zona todavía apunta a este
      // segmento (zona_clasificaciones.segmento_manual_id); sin este
      // catch, Postgres sube un 500 crudo en vez de un 409 legible.
      if (err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23503') {
        throw new ConflictException(
          'No se puede eliminar: hay zonas clasificadas con este segmento. Reclasifícalas antes de borrarlo.',
        );
      }
      throw err;
    }
  }

  /**
   * `code` y `name` son UNIQUE en el esquema; se valida antes de
   * intentar el INSERT/UPDATE para devolver un 409 legible en vez de que
   * el error de Postgres suba tal cual.
   */
  private async rechazarDuplicado(code?: string, name?: string, excludeId?: number) {
    if (code) {
      const existente = await this.segmentsRepo.findOne({ where: { code } });
      if (existente && existente.id !== excludeId) {
        throw new ConflictException(`Ya existe un segmento con el código ${code}.`);
      }
    }
    if (name) {
      const existente = await this.segmentsRepo.findOne({ where: { name } });
      if (existente && existente.id !== excludeId) {
        throw new ConflictException(`Ya existe un segmento con el nombre "${name}".`);
      }
    }
  }
}
