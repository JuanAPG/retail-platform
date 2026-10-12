import { notificationsApi } from './client';

export interface Notificacion {
  id: string;
  eventType: string;
  sourceService: string | null;
  title: string;
  message: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  priority: string;
  readBy: Array<{ userId: string; readAt: string }>;
  createdAt: string;
}

export interface PaginaNotificaciones {
  data: Notificacion[];
  total: number;
  page: number;
  limit: number;
}

export const getNotificaciones = (limit = 10) =>
  notificationsApi.get<PaginaNotificaciones>('/notifications', { params: { limit } }).then((r) => r.data);

/** Contrato de notifications-service: `{ unread: n }`. */
export const getNoLeidas = () =>
  notificationsApi.get<{ unread: number }>('/notifications/unread-count').then((r) => r.data.unread);

export const marcarLeida = (id: string) => notificationsApi.patch(`/notifications/${id}/read`).then((r) => r.data);
