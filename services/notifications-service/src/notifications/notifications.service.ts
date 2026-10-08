import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
} from './notification.types';
import { NOTIFICATIONS_REPOSITORY, NotificationsRepository } from './notifications.repository';

/**
 * Notificaciones internas. Reglas aplicadas literalmente:
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
    emisor?: { servicio?: string; ip?: string; token?: string },
  ): Promise<{ data: Notification; creada: boolean }> {
    if (!esEventoSoportado(dto.eventType)) {
      throw new BadRequestException(`El eventType ${dto.eventType} no está soportado.`);
    }
    if (!dto.recipientUserId && !dto.recipientRole) {
      throw new BadRequestException('recipientUserId o recipientRole es obligatorio.');
    }
    const base = atributosDe(dto.eventType);

    // Ventana anti-duplicados (mismo evento + entidad + DESTINATARIO):
    // idempotencia para emisores con reintentos, sin perder avisos ajenos.
    const ventana = new Date(Date.now() - VENTANA_DEDUP_MINUTOS * 60000);
    const existente = await this.repo.buscarReciente(
      dto.eventType,
      dto.relatedEntityId ?? null,
      { recipientUserId: dto.recipientUserId ?? null, recipientRole: dto.recipientRole ?? null },
      ventana,
    );
    if (existente) return { data: this.aPublica(existente), creada: false };

    const guardada = await this.repo.crear({
      eventType: dto.eventType,
      sourceService: emisor?.servicio ?? null,
      recipientUserId: dto.recipientUserId ?? null,
      recipientRole: dto.recipientRole ?? null,
      title: dto.title || base.title,
      message: dto.message,
      relatedEntityType: dto.relatedEntityType ?? base.relatedEntityType,
      relatedEntityId: dto.relatedEntityId ?? null,
      priority: dto.priority ?? base.priority,
    });

    await this.auditoria.reportar(
      {
        tabla: 'notificaciones',
        registroId: guardada.id,
        accion: 'insert',
        descripcion: `Notificación ${dto.eventType} para ${guardada.recipientUserId ?? guardada.recipientRole}.`,
        ip: emisor?.ip,
        cambios: [{ campo: 'evento', posterior: dto.eventType }],
      },
      emisor?.token,
    );

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

  async markAsRead(id: string, userId: string): Promise<Notification> {
    const fila = await this.repo.marcarLeida(id, userId);
    if (!fila) throw new NotFoundException('La notificación no existe.');
    return this.aPublica(fila);
  }

  async countUnread(userId: string, rol?: string): Promise<{ unread: number }> {
    return { unread: await this.repo.contarNoLeidas(userId, rol) };
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
