import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccionAuditoria, Auditoria } from '../entities/auditoria.entity';
import { AuditoriaCambio } from '../entities/auditoria-cambio.entity';
import { AuditFilterDto } from './dto/audit-filter.dto';

export interface AuditCambioInput {
  campo: string;
  previo?: string | null;
  posterior?: string | null;
}

export interface AuditLogInput {
  usuarioId?: string | null;
  rolId?: number | null;
  tabla: string;
  registroId?: string | null;
  accion: AccionAuditoria;
  descripcion?: string | null;
  ip?: string | null;
  cambios?: AuditCambioInput[];
}

export interface AuditPage {
  data: Auditoria[];
  total: number;
  page: number;
  limit: number;
}

/**
 * M15 — Único escritor y lector de `auditoria` + `auditoria_cambios`.
 *
 * `log()` nunca lanza: la bitácora es append-only y secundaria; si su
 * insert falla, se avisa por Logger y la operación de negocio que la
 * originó sigue su curso. Por eso los servicios la llaman con `await`
 * sin `try/catch`: el `await` solo ordena (el evento queda antes de la
 * respuesta), nunca propaga un error.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(Auditoria)
    private readonly auditoriaRepo: Repository<Auditoria>,
    @InjectRepository(AuditoriaCambio)
    private readonly cambiosRepo: Repository<AuditoriaCambio>,
  ) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      const evento = await this.auditoriaRepo.save(
        this.auditoriaRepo.create({
          usuarioId: input.usuarioId ?? null,
          rolId: input.rolId ?? null,
          tablaAfectada: input.tabla,
          registroId: input.registroId ?? null,
          accion: input.accion,
          descripcion: input.descripcion ?? null,
          direccionIp: input.ip ?? null,
        }),
      );

      if (input.cambios && input.cambios.length > 0) {
        await this.cambiosRepo.save(
          input.cambios.map((cambio) =>
            this.cambiosRepo.create({
              auditoriaId: evento.id,
              campo: cambio.campo,
              valorPrevio: cambio.previo ?? null,
              valorPosterior: cambio.posterior ?? null,
            }),
          ),
        );
      }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `No se pudo registrar auditoría (${input.tabla}:${input.accion}): ${motivo}`,
      );
    }
  }

  /** Bitácora paginada, de la más reciente a la más antigua. */
  async find(filters: AuditFilterDto): Promise<AuditPage> {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 20, 100);

    const qb = this.auditoriaRepo
      .createQueryBuilder('evento')
      .leftJoinAndSelect('evento.cambios', 'cambios')
      .orderBy('evento.fecha', 'DESC')
      .addOrderBy('evento.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (filters.tabla) {
      qb.andWhere('evento.tablaAfectada = :tabla', { tabla: filters.tabla });
    }
    if (filters.registroId) {
      qb.andWhere('evento.registroId = :registroId', { registroId: filters.registroId });
    }
    if (filters.usuarioId) {
      qb.andWhere('evento.usuarioId = :usuarioId', { usuarioId: filters.usuarioId });
    }
    if (filters.accion) {
      qb.andWhere('evento.accion = :accion', { accion: filters.accion });
    }
    if (filters.dateFrom) {
      qb.andWhere('evento.fecha >= :dateFrom', { dateFrom: filters.dateFrom });
    }
    if (filters.dateTo) {
      qb.andWhere('evento.fecha < CAST(:dateTo AS date) + 1', { dateTo: filters.dateTo });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }
}
