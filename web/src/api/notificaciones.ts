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

export const getNoLeidas = () =>
  notificationsApi
    .get<{ unread?: number; count?: number; total?: number }>('/notifications/unread-count')
    .then((r) => r.data.unread ?? r.data.count ?? r.data.total ?? 0);

export const marcarLeida = (id: string) => notificationsApi.patch(`/notifications/${id}/read`).then((r) => r.data);
