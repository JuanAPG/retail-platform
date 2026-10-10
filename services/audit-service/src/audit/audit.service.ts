import { Injectable, NotFoundException } from '@nestjs/common';
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

export interface AuditEventoInput {
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

/**
 * Huso en el que se resuelven los días de `dateFrom`/`dateTo`. La
 * bitácora la leen personas en Monterrey, así que "el 10 de octubre" es
 * el 10 de octubre local, de 00:00 a 23:59:59 hora de Monterrey, no el
 * día UTC: con el huso de Postgres (UTC) todo lo posterior a las 18:00
 * locales caía en el día siguiente y un evento de las 21:00 no aparecía
 * al filtrar por su propia fecha. Configurable por si el despliegue de
 * GCP queda en otra zona.
 */
export const ZONA_HORARIA = process.env.AUDIT_TIMEZONE ?? 'America/Monterrey';

export interface AuditPage {
  data: Auditoria[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Único escritor y lector de `auditoria` + `auditoria_cambios`.
 *
 * Solo hay un camino de escritura (`registrar()`, desde
 * `POST /v1/auditoria`): ningún microservicio usa audit-service como
 * librería, todos reportan por HTTP con su `AuditReporter`.
 */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(Auditoria)
    private readonly auditoriaRepo: Repository<Auditoria>,
  ) {}

  /**
   * Registra un evento reportado por HTTP y devuelve su id. Propaga
   * errores: el llamante es otro servicio que ya decidió reportar y
   * merece un 201/500 honesto (su timeout y su fire-and-forget lo
   * protegen de bloquearse).
   *
   * El evento y sus `cambios` se guardan en UNA transacción: en una
   * bitácora append-only, un evento "precio actualizado" sin los campos
   * que cambió es un registro que miente y que nadie puede corregir
   * después. O entran los dos, o no entra ninguno.
   */
  async registrar(input: AuditEventoInput): Promise<string> {
    return this.auditoriaRepo.manager.transaction(async (manager) => {
      const evento = await manager.save(
        manager.create(Auditoria, {
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
        await manager.save(
          input.cambios.map((cambio) =>
            manager.create(AuditoriaCambio, {
              auditoriaId: evento.id,
              campo: cambio.campo,
              valorPrevio: cambio.previo ?? null,
              valorPosterior: cambio.posterior ?? null,
            }),
          ),
        );
      }

      return evento.id;
    });
  }

  /**
   * Bitácora paginada, de la más reciente a la más antigua.
   *
   * `dateFrom`/`dateTo` son días completos (`YYYY-MM-DD`, lo valida el
   * DTO) y los DOS se comparan como fecha, no como instante: `dateFrom`
   * desde las 00:00 de ese día y `dateTo` hasta el final del día, como
   * dice el contrato. Los límites se construyen con `AT TIME ZONE`
   * (`ZONA_HORARIA`) y no con el huso de la sesión de Postgres: así el
   * día es el día local de quien lee la bitácora, corra la base donde
   * corra. `fecha` es TIMESTAMPTZ, o sea un instante, y Postgres hace la
   * conversión.
   *
   * `skip`/`take` (no `offset`/`limit`) es obligatorio con el
   * `leftJoinAndSelect` de `cambios`: TypeORM pagina por entidad con una
   * subconsulta de ids, así que `total` cuenta EVENTOS y una página de 20
   * trae 20 eventos aunque traigan varios `cambios` cada uno. Con
   * `offset`/`limit` contaría filas del JOIN.
   */
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
      qb.andWhere("evento.fecha >= CAST(:dateFrom AS date)::timestamp AT TIME ZONE :zona", {
        dateFrom: filters.dateFrom,
        zona: ZONA_HORARIA,
      });
    }
    if (filters.dateTo) {
      qb.andWhere("evento.fecha < (CAST(:dateTo AS date) + 1)::timestamp AT TIME ZONE :zona", {
        dateTo: filters.dateTo,
        zona: ZONA_HORARIA,
      });
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
