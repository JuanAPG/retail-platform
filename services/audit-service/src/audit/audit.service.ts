import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  servicio: string;
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
 * Único escritor y lector de `auditoria` + `auditoria_cambios`.
 *
 * `log()` nunca lanza: la bitácora es append-only y secundaria; si su
 * insert falla, se avisa por Logger y la operación de negocio que la
 * originó sigue su curso.
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

  async log(input: AuditLogInput): Promise<void> {    try {
      const evento = await this.auditoriaRepo.save(
        this.auditoriaRepo.create({
          usuarioId: input.usuarioId ?? null,
          rolId: input.rolId ?? null,
          tablaAfectada: input.tabla,
          registroId: input.registroId ?? null,
          servicio: input.servicio,
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

  /**
   * Registra un evento reportado por HTTP y devuelve su id. A diferencia
   * de `log()`, SÍ propaga errores: el llamante es otro servicio que ya
   * decidió reportar y merece un 201/500 honesto (su timeout y su
   * fire-and-forget lo protegen de bloquearse).
   */
  async registrar(input: AuditLogInput): Promise<string> {
    const evento = await this.auditoriaRepo.save(
      this.auditoriaRepo.create({
        usuarioId: input.usuarioId ?? null,
        rolId: input.rolId ?? null,
        tablaAfectada: input.tabla,
        registroId: input.registroId ?? null,
        servicio: input.servicio,
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

    return evento.id;
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
    if (filters.servicio) {
      qb.andWhere('evento.servicio = :servicio', { servicio: filters.servicio });
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

  /**
   * Detalle de un evento. 404 si no existe — incluido un id no numérico:
   * el id es `bigint` en Postgres, así que compararlo contra un string no
   * numérico daría un 500 (`invalid input syntax for type bigint`) en vez
   * de un 404 honesto si se dejara pasar tal cual al repositorio.
   */
  async findOne(id: string): Promise<Auditoria> {
    if (!/^\d+$/.test(id)) {
      throw new NotFoundException('El evento no existe.');
    }
    const evento = await this.auditoriaRepo.findOne({
      where: { id },
      relations: { cambios: true },
    });
    if (!evento) {
      throw new NotFoundException('El evento no existe.');
    }
    return evento;
  }
}
