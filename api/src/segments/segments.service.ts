import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { IncomeSegment } from '../entities/income-segment.entity';
import { AuditContext, AuditService } from '../audit/audit.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';

@Injectable()
export class SegmentsService {
  constructor(
    @InjectRepository(IncomeSegment)
    private readonly segmentsRepo: Repository<IncomeSegment>,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateSegmentDto, ctx?: AuditContext): Promise<IncomeSegment> {
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

    const guardado = await this.segmentsRepo.save(segment);

    await this.audit.log({
      usuarioId: ctx?.actor?.id ?? null,
      rolId: ctx?.actor?.rolId ?? null,
      tabla: 'segmentos_ingreso',
      registroId: String(guardado.id),
      accion: 'insert',
      descripcion: `Segmento creado (${dto.code} - ${dto.name}).`,
      ip: ctx?.ip,
      cambios: [
        { campo: 'codigo', posterior: dto.code },
        { campo: 'nombre', posterior: dto.name },
      ],
    });

    return guardado;
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

  async update(id: number, dto: UpdateSegmentDto, ctx?: AuditContext): Promise<IncomeSegment> {
    const segment = await this.findOne(id);
    const previo: Record<string, string> = {
      codigo: segment.code,
      nombre: segment.name,
      ingreso_min: String(segment.incomeRangeMin),
    };

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

    const guardado = await this.segmentsRepo.save(segment);

    const posterior: Record<string, string> = {
      codigo: guardado.code,
      nombre: guardado.name,
      ingreso_min: String(guardado.incomeRangeMin),
    };
    await this.audit.log({
      usuarioId: ctx?.actor?.id ?? null,
      rolId: ctx?.actor?.rolId ?? null,
      tabla: 'segmentos_ingreso',
      registroId: String(id),
      accion: 'update',
      descripcion: `Segmento actualizado (${guardado.code}).`,
      ip: ctx?.ip,
      cambios: Object.keys(previo)
        .filter((campo) => previo[campo] !== posterior[campo])
        .map((campo) => ({ campo, previo: previo[campo], posterior: posterior[campo] })),
    });

    return guardado;
  }

  async remove(id: number, ctx?: AuditContext): Promise<void> {
    const segment = await this.findOne(id);
    const codigo = segment.code;

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

    await this.audit.log({
      usuarioId: ctx?.actor?.id ?? null,
      rolId: ctx?.actor?.rolId ?? null,
      tabla: 'segmentos_ingreso',
      registroId: String(id),
      accion: 'delete',
      descripcion: `Segmento eliminado (${codigo}).`,
      ip: ctx?.ip,
      cambios: [{ campo: 'codigo', previo: codigo, posterior: null }],
    });
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
