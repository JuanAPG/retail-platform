import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { IncomeSegment } from '../entities/income-segment.entity';
import { Pagina } from '../common/dto/pagination.dto';
import { paginar } from '../common/helpers/pagination.helper';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { SegmentFilterDto } from './dto/segment-filter.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';

@Injectable()
export class SegmentsService {
  constructor(
    @InjectRepository(IncomeSegment)
    private readonly segmentsRepo: Repository<IncomeSegment>,
  ) {}

  async create(dto: CreateSegmentDto): Promise<IncomeSegment> {
    await this.rechazarDuplicado(dto.code, dto.name);
    await this.validarRango(dto.incomeRangeMin, dto.incomeRangeMax ?? null);

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

  /** Orden fijo por ingreso mínimo ascendente (ver contrato). */
  findAll(filtros: SegmentFilterDto): Promise<Pagina<IncomeSegment>> {
    const qb = this.segmentsRepo
      .createQueryBuilder('s')
      .orderBy('s.incomeRangeMin', 'ASC')
      .addOrderBy('s.id', 'ASC');
    return paginar(qb, filtros);
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
    // El rango resultante (lo editado sobre lo que ya había) debe seguir siendo válido y no encimarse.
    if (dto.incomeRangeMin !== undefined || dto.incomeRangeMax !== undefined) {
      const min = dto.incomeRangeMin != null ? dto.incomeRangeMin : Number(segment.incomeRangeMin);
      const max = dto.incomeRangeMax !== undefined ? (dto.incomeRangeMax ?? null) : segment.incomeRangeMax != null ? Number(segment.incomeRangeMax) : null;
      await this.validarRango(min, max, id);
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
   * D-10: los rangos de ingreso no pueden encimarse. `max` nulo = sin tope. Dos rangos se cruzan si
   * `a.min <= b.max AND b.min <= a.max`. Sin esto, un rango con mínimo mayor al máximo llegaba a
   * Postgres y salía como 500 con el nombre del constraint.
   */
  private async validarRango(min: number, max: number | null, excludeId?: number) {
    if (max !== null && min >= max) {
      throw new BadRequestException('incomeRangeMin debe ser menor que incomeRangeMax.');
    }
    const existentes = await this.segmentsRepo.find();
    const choque = existentes.find((o) => {
      if (o.id === excludeId) return false;
      const oMin = Number(o.incomeRangeMin);
      const oMax = o.incomeRangeMax != null ? Number(o.incomeRangeMax) : Infinity;
      return min <= oMax && oMin <= (max ?? Infinity);
    });
    if (choque) {
      throw new ConflictException(
        `El rango se encima con el segmento ${choque.code} (${choque.incomeRangeMin} a ${choque.incomeRangeMax ?? 'sin tope'}). Los rangos no pueden encimarse.`,
      );
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
