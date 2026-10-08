import { Global, Injectable, Logger, Module } from '@nestjs/common';

/** Evento a emitir (ver docs/contratos/notifications-service.md). El destinatario lo fija el receptor según el evento. */
export interface EventoNotificacion {
  eventType: 'precio.propuesto' | 'propuesta.resuelta' | 'precio.umbral';
  relatedEntityType: string;
  relatedEntityId: string;
  title: string;
  message: string;
  priority?: 'info' | 'warning' | 'critical';
  /** Solo para eventos con destino de usuario (`propuesta.resuelta`: quien propuso). */
  recipientUserId?: string;
}

/**
 * Emite eventos a notifications-service SIN romper nunca la operación que los origina:
 * timeout corto, todo error se traga y se deja en Logger. Reenvía el `Authorization`
 * de quien originó la acción: con su rol el receptor valida el origen.
 * Contrato: `POST {NOTIFICATIONS_SERVICE_URL}/v1/notifications`.
 */
@Injectable()
export class NotificationsReporter {
  private readonly logger = new Logger(NotificationsReporter.name);

  async emitir(evento: EventoNotificacion, token?: string): Promise<void> {
    const base = process.env.NOTIFICATIONS_SERVICE_URL;
    if (!base) return;
    try {
      const control = new AbortController();
      const limite = setTimeout(() => control.abort(), 1500);
      try {
        const r = await fetch(`${base}/v1/notifications`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ ...evento, sourceService: 'pricing-service', priority: evento.priority ?? 'info' }),
          signal: control.signal,
        });
        if (!r.ok) this.logger.warn(`Notificación ${evento.eventType} rechazada: HTTP ${r.status}`);
      } finally {
        clearTimeout(limite);
      }
    } catch (error) {
      this.logger.warn(`Notificación no enviada (${evento.eventType}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Global: lo usan precios, propuestas, observaciones y alertas. */
@Global()
@Module({ providers: [NotificationsReporter], exports: [NotificationsReporter] })
export class NotificationsModule {}
