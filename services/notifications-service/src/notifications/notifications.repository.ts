import { Notification, Priority, ReadMark } from './notification.types';

/** Lo que el servicio necesita persistir (sin mongo acoplado). */
export interface NotificacionGuardada {
  id: string;
  eventType: string;
  sourceService: string | null;
  recipientUserId: string | null;
  recipientRole: string | null;
  title: string;
  message: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  priority: Priority;
  readBy: ReadMark[];
  archived: boolean;
  createdAt: Date;
}

/** Destinatario: id directo o rol (uno de los dos siempre presente). */
export interface Destinatario {
  recipientUserId: string | null;
  recipientRole: string | null;
}

export interface CrearNotificacion extends Destinatario {
  eventType: string;
  sourceService: string | null;
  title: string;
  message: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  priority: Priority;
}

/**
 * Puerto de persistencia. Hoy lo implementa el adaptador en memoria (sin
 * Mongo hasta que documents-service fije el patrón); entonces se agrega
 * el adaptador Mongoose SIN tocar el servicio (pendiente explícito).
 */
export interface NotificationsRepository {
  crear(datos: CrearNotificacion): Promise<NotificacionGuardada>;
  buscarReciente(
    eventType: string,
    relatedEntityId: string | null,
    destinatario: Destinatario,
    desde: Date,
  ): Promise<NotificacionGuardada | null>;
  listar(filtros: {
    userId: string;
    rol?: string;
    incluirArchivadas: boolean;
    dateFrom?: string;
    dateTo?: string;
    skip: number;
    limit: number;
  }): Promise<{ filas: NotificacionGuardada[]; total: number }>;
  marcarLeida(id: string, userId: string): Promise<NotificacionGuardada | null>;
  contarNoLeidas(userId: string, rol?: string): Promise<number>;
  archivarAnteriores(corte: Date): Promise<number>;
}

export const NOTIFICATIONS_REPOSITORY = 'NOTIFICATIONS_REPOSITORY';
