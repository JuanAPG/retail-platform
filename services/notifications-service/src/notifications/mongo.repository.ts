import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model } from 'mongoose';
import { APROBACION_PENDIENTE } from './notification.types';
import { NotificationPreference } from './schemas/preference.schema';
import {
  CrearNotificacion,
  Destinatario,
  NotificacionGuardada,
  NotificationsRepository,
} from './notifications.repository';
import { asegurarMongo } from '../common/mongo/asegurar-mongo';
import { NotificacionDocument, NotificacionMongo } from './schemas/notification.schema';

/**
 * Adaptador MongoDB del puerto NOTIFICATIONS_REPOSITORY (mismo patrón que
 * documents-service). Con Mongo caído responde 503 al instante en vez de
 * dejar la petición colgada (`bufferCommands: false` en AppModule).
 */
@Injectable()
export class MongoNotificationsRepository implements NotificationsRepository {
  constructor(
    @InjectModel(NotificacionMongo.name) private readonly modelo: Model<NotificacionDocument>,
    @InjectModel(NotificationPreference.name) private readonly preferencias: Model<NotificationPreference>,
    @InjectConnection() private readonly conexion: Connection,
  ) {}

  async crear(datos: CrearNotificacion): Promise<NotificacionGuardada> {
    await this.exigirMongo();
    const doc = await this.modelo.create({ ...datos, readBy: [], archived: false, createdAt: new Date() });
    return this.aGuardada(doc.toObject());
  }

  async buscarReciente(
    eventType: string,
    relatedEntityId: string | null,
    destinatario: Destinatario,
    desde: Date,
  ): Promise<NotificacionGuardada | null> {
    await this.exigirMongo();
    const doc = await this.modelo
      .findOne({
        eventType,
        relatedEntityId: relatedEntityId ?? null,
        recipientUserId: destinatario.recipientUserId ?? null,
        recipientRole: destinatario.recipientRole ?? null,
        archived: false,
        createdAt: { $gte: desde },
      })
      .sort({ createdAt: -1 })
      .lean();
    return doc ? this.aGuardada(doc) : null;
  }

  async listar(filtros: {
    userId: string;
    rol?: string;
    incluirArchivadas: boolean;
    soloObligatorias?: boolean;
    dateFrom?: string;
    dateTo?: string;
    skip: number;
    limit: number;
  }): Promise<{ filas: NotificacionGuardada[]; total: number }> {
    await this.exigirMongo();
    const filtro: FilterQuery<NotificacionDocument> = this.visibles(filtros.userId, filtros.rol, filtros.soloObligatorias);
    if (!filtros.incluirArchivadas) filtro.archived = false;
    if (filtros.dateFrom || filtros.dateTo) {
      filtro.createdAt = {};
      if (filtros.dateFrom) filtro.createdAt.$gte = new Date(filtros.dateFrom);
      // dateTo es inclusivo: hasta el final de ese día.
      if (filtros.dateTo) filtro.createdAt.$lt = new Date(new Date(filtros.dateTo).getTime() + 86400000);
    }
    const [docs, total] = await Promise.all([
      this.modelo.find(filtro).sort({ createdAt: -1 }).skip(filtros.skip).limit(filtros.limit).lean(),
      this.modelo.countDocuments(filtro),
    ]);
    return { filas: docs.map((doc) => this.aGuardada(doc)), total };
  }

  async buscarPorId(id: string): Promise<NotificacionGuardada | null> {
    await this.exigirMongo();
    const doc = await this.modelo.findById(id).lean();
    return doc ? this.aGuardada(doc) : null;
  }

  async marcarLeida(id: string, userId: string): Promise<NotificacionGuardada | null> {
    await this.exigirMongo();
    // Solo agrega la marca si ese usuario no la tiene: idempotente.
    await this.modelo.updateOne(
      { _id: id, 'readBy.userId': { $ne: userId } },
      { $push: { readBy: { userId, readAt: new Date() } } },
    );
    return this.buscarPorId(id);
  }

  async contarNoLeidas(userId: string, rol?: string, soloObligatorias?: boolean): Promise<number> {
    await this.exigirMongo();
    return this.modelo.countDocuments({
      ...this.visibles(userId, rol, soloObligatorias),
      archived: false,
      'readBy.userId': { $ne: userId },
    });
  }

  async archivarAnteriores(corte: Date): Promise<number> {
    await this.exigirMongo();
    const r = await this.modelo.updateMany({ archived: false, createdAt: { $lt: corte } }, { $set: { archived: true } });
    return r.modifiedCount;
  }

  async aceptaInformativas(userId: string): Promise<boolean> {
    await this.exigirMongo();
    const document = await this.preferencias.findById(userId).lean();
    return document?.informational ?? true;
  }

  async guardarPreferencia(userId: string, informational: boolean): Promise<void> {
    await this.exigirMongo();
    await this.preferencias.updateOne({ _id: userId }, { $set: { informational } }, { upsert: true });
  }

  private visibles(userId: string, role?: string, requiredOnly?: boolean): FilterQuery<NotificacionDocument> {
    const recipient = { $or: this.destinatarioDe(userId, role) };
    if (!requiredOnly) return recipient;
    return { $and: [recipient, {
      $or: [{ priority: { $ne: 'info' } }, { eventType: { $in: APROBACION_PENDIENTE } }],
    }] };
  }

  private destinatarioDe(userId: string, rol?: string): FilterQuery<NotificacionDocument>[] {
    const opciones: FilterQuery<NotificacionDocument>[] = [{ recipientUserId: userId }];
    if (rol != null) opciones.push({ recipientRole: rol });
    return opciones;
  }

  private async exigirMongo(): Promise<void> {
    if (!(await asegurarMongo(this.conexion))) {
      throw new ServiceUnavailableException('Las notificaciones (MongoDB) no están disponibles. Intenta más tarde.');
    }
  }

  private aGuardada(doc: NotificacionMongo): NotificacionGuardada {
    return {
      id: doc._id,
      eventType: doc.eventType,
      sourceService: doc.sourceService ?? null,
      recipientUserId: doc.recipientUserId ?? null,
      recipientRole: doc.recipientRole ?? null,
      title: doc.title,
      message: doc.message,
      relatedEntityType: doc.relatedEntityType ?? null,
      relatedEntityId: doc.relatedEntityId ?? null,
      priority: doc.priority,
      correlationId: doc.correlationId ?? null,
      readBy: (doc.readBy ?? []).map((m) => ({ userId: m.userId, readAt: new Date(m.readAt) })),
      archived: doc.archived,
      createdAt: new Date(doc.createdAt),
    };
  }
}
