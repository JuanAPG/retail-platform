import { randomUUID } from 'crypto';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Priority, ReadMark } from '../notification.types';

/**
 * Colección `notificaciones`. Lectura por usuario en `readBy` (nunca flag
 * global) y archivado en vez de borrado.
 */
@Schema({ collection: 'notificaciones', versionKey: false })
export class NotificacionMongo {
  /** UUID v4 y no ObjectId: el contrato y `ParseUUIDPipe` exponen ids UUID. */
  @Prop({ type: String, default: () => randomUUID() })
  _id!: string;

  @Prop({ required: true })
  eventType!: string;

  @Prop({ type: String, default: null })
  sourceService!: string | null;

  @Prop({ type: String, default: null })
  recipientUserId!: string | null;

  @Prop({ type: String, default: null })
  recipientRole!: string | null;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  message!: string;

  @Prop({ type: String, default: null })
  relatedEntityType!: string | null;

  @Prop({ type: String, default: null })
  relatedEntityId!: string | null;

  @Prop({ required: true, enum: ['info', 'warning', 'critical'] })
  priority!: Priority;

  @Prop({ type: [{ _id: false, userId: String, readAt: Date }], default: [] })
  readBy!: ReadMark[];

  @Prop({ required: true, default: false })
  archived!: boolean;

  @Prop({ required: true, default: () => new Date() })
  createdAt!: Date;
}

export type NotificacionDocument = HydratedDocument<NotificacionMongo>;
export const NotificacionSchema = SchemaFactory.createForClass(NotificacionMongo);

// Bandeja de un usuario y de un rol, siempre por fecha desc.
NotificacionSchema.index({ recipientUserId: 1, createdAt: -1 });
NotificacionSchema.index({ recipientRole: 1, createdAt: -1 });
// Ventana anti-duplicados (buscarReciente).
NotificacionSchema.index({ eventType: 1, relatedEntityId: 1, recipientUserId: 1, recipientRole: 1, createdAt: -1 });
// Job de archivado.
NotificacionSchema.index({ archived: 1, createdAt: 1 });
