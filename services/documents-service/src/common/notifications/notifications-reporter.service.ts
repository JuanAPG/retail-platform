import { Injectable, Logger } from '@nestjs/common';
import { conCorrelacion } from '../correlation/correlacion';

/**
 * Evento a emitir (docs/contratos/notifications-service.md).
 *
 * `reporte.generado` (T-20): emisor documents-service, origen Gerente de
 * categoría, destino el mismo usuario que hizo la acción (`actor`).
 */
export interface EventoNotificacion {
  eventType: 'reporte.generado';
  relatedEntityType: string;
  relatedEntityId: string;
  title: string;
  message: string;
  priority?: 'info' | 'warning' | 'critical';
  recipientUserId?: string;
}

/**
 * Emite a notifications-service SIN romper nunca la operación que lo origina:
 * timeout corto, todo error se traga y se deja en Logger. Reenvía el
 * `Authorization` de quien originó la acción y el `X-Correlation-Id` (T-02).
 * Devuelve si notifications lo aceptó, para que el emisor sepa si reintentar.
 */
@Injectable()
export class NotificationsReporter {
  private readonly logger = new Logger(NotificationsReporter.name);

  async emitir(evento: EventoNotificacion, token?: string): Promise<boolean> {
    const base = process.env.NOTIFICATIONS_SERVICE_URL;
    if (!base) return false;
    try {
      const control = new AbortController();
      const limite = setTimeout(() => control.abort(), 1500);
      try {
        const r = await fetch(`${base}/v1/notifications`, {
          method: 'POST',
          headers: conCorrelacion({
            'Content-Type': 'application/json',
            ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
          }),
          body: JSON.stringify({ ...evento, sourceService: 'documents-service', priority: evento.priority ?? 'info' }),
          signal: control.signal,
        });
        if (!r.ok) this.logger.warn(`Notificación ${evento.eventType} rechazada: HTTP ${r.status}`);
        return r.ok;
      } finally {
        clearTimeout(limite);
      }
    } catch (error) {
      this.logger.warn(`Notificación no enviada (${evento.eventType}): ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
