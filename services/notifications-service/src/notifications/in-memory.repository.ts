import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  CrearNotificacion,
  NOTIFICATIONS_REPOSITORY,
  NotificacionGuardada,
  NotificationsRepository,
} from './notifications.repository';

export { NOTIFICATIONS_REPOSITORY };

/**
 * Adaptador en memoria. Solo existe para unitarias y desarrollo sin Mongo:
 * cuando documents-service fije el patrón se agrega el adaptador Mongoose
 * y este se retira (el servicio no cambia porque depende del puerto).
 */
@Injectable()
export class InMemoryNotificationsRepository implements NotificationsRepository {
  private readonly filas = new Map<string, NotificacionGuardada>();

  async crear(datos: CrearNotificacion): Promise<NotificacionGuardada> {
    const fila: NotificacionGuardada = {
      id: randomUUID(),
      ...datos,
      readBy: [],
      archived: false,
      createdAt: new Date(),
    };
    this.filas.set(fila.id, fila);
    return fila;
  }

  async buscarReciente(
    eventType: string,
    relatedEntityId: string | null,
    destinatario: { recipientUserId: string | null; recipientRole: string | null },
    desde: Date,
  ): Promise<NotificacionGuardada | null> {
    for (const fila of this.filas.values()) {
      if (
        !fila.archived &&
        fila.eventType === eventType &&
        (fila.relatedEntityId ?? null) === (relatedEntityId ?? null) &&
        (fila.recipientUserId ?? null) === (destinatario.recipientUserId ?? null) &&
        (fila.recipientRole ?? null) === (destinatario.recipientRole ?? null) &&
        fila.createdAt >= desde
      ) {
        return fila;
      }
    }
    return null;
  }

  async listar(filtros: {
    userId: string;
    rol?: string;
    incluirArchivadas: boolean;
    dateFrom?: string;
    dateTo?: string;
    skip: number;
    limit: number;
  }): Promise<{ filas: NotificacionGuardada[]; total: number }> {
    const todas = [...this.filas.values()]
      .filter(
        (fila) =>
          fila.recipientUserId === filtros.userId ||
          (filtros.rol != null && fila.recipientRole === filtros.rol),
      )
      .filter((fila) => filtros.incluirArchivadas || !fila.archived)
      .filter((fila) => !filtros.dateFrom || fila.createdAt >= new Date(filtros.dateFrom))
      .filter(
        (fila) =>
          !filtros.dateTo || fila.createdAt < new Date(new Date(filtros.dateTo).getTime() + 86400000),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { filas: todas.slice(filtros.skip, filtros.skip + filtros.limit), total: todas.length };
  }

  async buscarPorId(id: string): Promise<NotificacionGuardada | null> {
    return this.filas.get(id) ?? null;
  }

  async marcarLeida(id: string, userId: string): Promise<NotificacionGuardada | null> {
    const fila = this.filas.get(id);
    if (!fila) return null;
    if (!fila.readBy.some((marca) => marca.userId === userId)) {
      fila.readBy.push({ userId, readAt: new Date() });
    }
    return fila;
  }

  async contarNoLeidas(userId: string, rol?: string): Promise<number> {
    let total = 0;
    for (const fila of this.filas.values()) {
      if (fila.archived) continue;
      if (fila.recipientUserId !== userId && (rol == null || fila.recipientRole !== rol)) continue;
      if (fila.readBy.some((marca) => marca.userId === userId)) continue;
      total++;
    }
    return total;
  }

  async archivarAnteriores(corte: Date): Promise<number> {
    let archivadas = 0;
    for (const fila of this.filas.values()) {
      if (!fila.archived && fila.createdAt < corte) {
        fila.archived = true;
        archivadas++;
      }
    }
    return archivadas;
  }
}
