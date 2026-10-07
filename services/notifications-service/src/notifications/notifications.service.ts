import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { NotificationFilterDto } from './dto/notification-filter.dto';
import { InMemoryNotificationsRepository } from './in-memory.repository';
import {
  DIAS_PARA_ARCHIVAR,
  Notification,
  VENTANA_DEDUP_MINUTOS,
  atributosDe,
  esEventoSoportado,
  permisoDe,
} from './notification.types';
import { NOTIFICATIONS_REPOSITORY, NotificationsRepository } from './notifications.repository';

/**
 * Notificaciones internas. Reglas aplicadas literalmente:
 * - **Quién emite qué** lo decide la tabla de `notification.types.ts`, no
 *   el emisor: antes cualquier autenticado podía fabricar cualquier evento
 *   para cualquier destinatario.
 * - **Quién la ve** lo decide el destinatario: una notificación que no va
 *   dirigida al usuario del token no existe para él (404), ni para leerla
 *   ni para marcarla.
 * - Lectura por usuario en `readBy`, nunca flag global.
 * - Sin duplicados (mismo evento+entidad no archivada en 5 min): responde
 *   la existente con 200 en vez de crear.
 * - Archivado a 90 días por job; jamás se elimina.
 * - Cada creación reporta a audit-service (best-effort, no bloquea).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATIONS_REPOSITORY)
    private readonly repo: NotificationsRepository,
    private readonly auditoria: AuditReporter,
  ) {}

  async create(
    dto: CreateNotificationDto,
    emisor: {
      usuarioId?: string;
      /** Rol del usuario que ORIGINÓ la acción, del JWT que reenvía el emisor. */
      rol?: string;
      rolId?: number;
      ip?: string;
    } = {},
  ): Promise<{ data: Notification; creada: boolean }> {
    if (!esEventoSoportado(dto.eventType)) {
      throw new BadRequestException(`El eventType ${dto.eventType} no está soportado.`);
    }
    const permiso = permisoDe(dto.eventType);

    // 1. ¿Puede este ROL originar este evento? Los servicios emisores
    //    reenvían el Authorization del usuario que originó la acción, así
    //    que el rol del token ES el rol de origen.
    if (permiso.origenes.length === 0) {
      throw new ForbiddenException(
        `El evento ${dto.eventType} no tiene regla de origen definida todavía: nadie puede emitirlo.`,
      );
    }
    if (!emisor.rol || !permiso.origenes.includes(emisor.rol)) {
      throw new ForbiddenException(
        `Un ${emisor.rol ?? 'usuario sin rol'} no puede originar ${dto.eventType}. ` +
          `Solo: ${permiso.origenes.join(', ')}.`,
      );
    }

    // 2. El DESTINATARIO lo fija la regla del evento, no el emisor.
    const destinatario = this.resolverDestinatario(dto, permiso);
    const base = atributosDe(dto.eventType);

    // Ventana anti-duplicados (mismo evento + entidad + DESTINATARIO):
    // idempotencia para emisores con reintentos, sin perder avisos ajenos.
    const ventana = new Date(Date.now() - VENTANA_DEDUP_MINUTOS * 60000);
    const existente = await this.repo.buscarReciente(
      dto.eventType,
      dto.relatedEntityId ?? null,
      destinatario,
      ventana,
    );
    if (existente) return { data: this.aPublica(existente), creada: false };

    const guardada = await this.repo.crear({
      eventType: dto.eventType,
      // Del DTO, validado contra la lista cerrada: antes se leía de un
      // campo que el controlador nunca mandaba y quedaba siempre null.
      sourceService: dto.sourceService,
      ...destinatario,
      title: dto.title || base.title,
      message: dto.message,
      relatedEntityType: dto.relatedEntityType ?? base.relatedEntityType,
      relatedEntityId: dto.relatedEntityId ?? null,
      priority: dto.priority ?? base.priority,
    });

    await this.auditoria.reportar({
      tabla: 'notificaciones',
      registroId: guardada.id,
      accion: 'insert',
      descripcion: `Notificación ${dto.eventType} para ${guardada.recipientUserId ?? guardada.recipientRole}.`,
      usuarioId: emisor.usuarioId ?? null,
      rolId: emisor.rolId ?? null,
      ip: emisor.ip,
      cambios: [
        { campo: 'evento', posterior: dto.eventType },
        { campo: 'sourceService', posterior: dto.sourceService },
        { campo: 'rolOrigen', posterior: emisor.rol ?? '' },
      ],
    });

    return { data: this.aPublica(guardada), creada: true };
  }

  async findAllForUser(
    userId: string,
    rol: string | undefined,
    filtros: NotificationFilterDto,
  ): Promise<{ data: Notification[]; total: number; page: number; limit: number }> {
    const page = filtros.page ?? 1;
    const limit = Math.min(filtros.limit ?? 20, 100);
    const { filas, total } = await this.repo.listar({
      userId,
      rol,
      incluirArchivadas: filtros.archived === 'true',
      dateFrom: filtros.dateFrom,
      dateTo: filtros.dateTo,
      skip: (page - 1) * limit,
      limit,
    });
    return { data: filas.map((fila) => this.aPublica(fila)), total, page, limit };
  }

  /**
   * Marca como leída SOLO si la notificación va dirigida al usuario.
   *
   * Antes no se comprobaba el destinatario: un Proveedor marcaba como
   * leída una notificación del Gerente y la respuesta le devolvía el
   * contenido completo. Se responde 404 y no 403 a propósito: un 403
   * confirmaría que esa notificación existe.
   */
  async markAsRead(id: string, usuario: { id: string; rol?: string }): Promise<Notification> {
    await this.exigirDestinatario(id, usuario);
    const fila = await this.repo.marcarLeida(id, usuario.id);
    if (!fila) throw new NotFoundException('La notificación no existe.');
    return this.aPublica(fila);
  }

  /** Lectura por id, sujeta a la misma regla de destinatario. */
  async findOneForUser(id: string, usuario: { id: string; rol?: string }): Promise<Notification> {
    return this.aPublica(await this.exigirDestinatario(id, usuario));
  }

  async countUnread(userId: string, rol?: string): Promise<{ unread: number }> {
    return { unread: await this.repo.contarNoLeidas(userId, rol) };
  }

  /**
   * El destinatario manda: `recipientUserId` igual a su id, o
   * `recipientRole` igual a su rol. Cualquier otra cosa es un 404, sin
   * devolver nada del contenido.
   */
  private async exigirDestinatario(
    id: string,
    usuario: { id: string; rol?: string },
  ): Promise<Parameters<NotificationsService['aPublica']>[0]> {
    const fila = await this.repo.buscarPorId(id);
    if (!fila) throw new NotFoundException('La notificación no existe.');

    const esSuya =
      fila.recipientUserId === usuario.id ||
      (fila.recipientRole != null && usuario.rol != null && fila.recipientRole === usuario.rol);
    if (!esSuya) {
      this.logger.warn(
        `Acceso denegado a la notificación ${id}: ${usuario.id} (${usuario.rol ?? 'sin rol'}) no es su destinatario.`,
      );
      // Mismo mensaje que cuando no existe: no se filtra su existencia.
      throw new NotFoundException('La notificación no existe.');
    }
    return fila;
  }

  /**
   * Aplica la regla de destino del evento.
   *
   * `rol`: destino fijo; si el emisor manda otro, se rechaza en vez de
   * ignorarlo en silencio —un emisor que cree estar avisando a alguien
   * más tiene un bug, y callarlo lo esconde.
   */
  private resolverDestinatario(
    dto: CreateNotificationDto,
    permiso: ReturnType<typeof permisoDe>,
  ): { recipientUserId: string | null; recipientRole: string | null } {
    const { destino } = permiso;

    if (destino.tipo === 'rol') {
      if (dto.recipientRole && dto.recipientRole !== destino.rol) {
        throw new BadRequestException(
          `${dto.eventType} siempre va al rol ${destino.rol}; no se puede dirigir a ${dto.recipientRole}.`,
        );
      }
      if (dto.recipientUserId) {
        throw new BadRequestException(
          `${dto.eventType} va al rol ${destino.rol}, no a un usuario concreto.`,
        );
      }
      return { recipientUserId: null, recipientRole: destino.rol };
    }

    if (destino.tipo === 'usuario') {
      if (!dto.recipientUserId) {
        throw new BadRequestException(
          `${dto.eventType} va a un usuario concreto: falta recipientUserId.`,
        );
      }
      return { recipientUserId: dto.recipientUserId, recipientRole: null };
    }

    // `pendiente`: el equipo aún no fijó el destino de este evento, así
    // que se respeta lo que mande el emisor. El ORIGEN sí se valido arriba.
    if (!dto.recipientUserId && !dto.recipientRole) {
      throw new BadRequestException('recipientUserId o recipientRole es obligatorio.');
    }
    return {
      recipientUserId: dto.recipientUserId ?? null,
      recipientRole: dto.recipientRole ?? null,
    };
  }

  /** Job diario: archiva lo mayor a 90 días. Nunca elimina. */
  @Cron('0 3 * * *')
  async archivarViejas(): Promise<void> {
    try {
      const corte = new Date(Date.now() - DIAS_PARA_ARCHIVAR * 86400000);
      const archivadas = await this.repo.archivarAnteriores(corte);
      if (archivadas > 0) this.logger.log(`Notificaciones archivadas: ${archivadas}.`);
    } catch (error) {
      this.logger.warn(`Archivado fallido: ${error instanceof Error ? error.message : error}`);
    }
  }

  private aPublica(fila: {
    id: string;
    eventType: string;
    sourceService: string | null;
    recipientUserId: string | null;
    recipientRole: string | null;
    title: string;
    message: string;
    relatedEntityType: string | null;
    relatedEntityId: string | null;
    priority: Notification['priority'];
    readBy: { userId: string; readAt: Date }[];
    archived: boolean;
    createdAt: Date;
  }): Notification {
    return {
      ...fila,
      readBy: fila.readBy.map((marca) => ({ userId: marca.userId, readAt: marca.readAt.toISOString() })),
      createdAt: fila.createdAt.toISOString(),
    };
  }
}

export { InMemoryNotificationsRepository };
