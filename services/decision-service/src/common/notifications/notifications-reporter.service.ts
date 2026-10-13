import { Injectable, Logger } from '@nestjs/common';

/** Nombre de este microservicio para el campo `sourceService` (lista cerrada del receptor). */
const SERVICIO = 'decision-service';

/** Eventos de decision-service en el catálogo cerrado de notifications-service (D-12). */
export type EventoDecision = 'escenario.generado' | 'recomendacion.generada' | 'recomendacion.resuelta';

/** `relatedEntityType` de cada evento, el mismo que usa el receptor en su matriz. */
const ENTIDAD: Record<EventoDecision, string> = {
  'escenario.generado': 'escenario',
  'recomendacion.generada': 'recomendacion',
  'recomendacion.resuelta': 'recomendacion',
};

export interface AvisoDecision {
  evento: EventoDecision;
  /** Solo para eventos con destino de usuario (`escenario.generado`). */
  recipientUserId?: string;
  /** Solo para eventos con destino de rol; debe ser el rol fijo del evento o el receptor responde 400. */
  recipientRole?: string;
  /**
   * El contrato no tiene un campo libre: el detalle viaja en estos tres
   * (el receptor corre con `forbidNonWhitelisted`, cualquier otro es 400).
   */
  payload: {
    relatedEntityId: string;
    title: string;
    message: string;
  };
}

/**
 * Mismo patrón que `AuditReporter`: avisa a notifications-service SIN
 * romper nunca la operación que origina el aviso. Timeout corto, todo
 * error (red, timeout, 403, 5xx) se traga y se deja en Logger; nunca lanza.
 * Contrato: `POST {NOTIFICATIONS_SERVICE_URL}/v1/notifications`
 * (docs/contratos/notifications-service.md).
 *
 * El receptor valida con el ROL del token quién puede originar cada
 * evento: hay que REENVIAR el `Authorization` de quien hizo la acción,
 * nunca una cuenta de servicio ni un token propio.
 */
@Injectable()
export class NotificationsReporter {
  private readonly logger = new Logger(NotificationsReporter.name);
  private sinUrlAvisado = false;

  async notificar(aviso: AvisoDecision, ctx: { token?: string } = {}): Promise<void> {
    const base = process.env.NOTIFICATIONS_SERVICE_URL;
    if (!base) {
      // Una sola vez: sin URL no se avisa a nadie, pero tampoco se llena el log.
      if (!this.sinUrlAvisado) {
        this.sinUrlAvisado = true;
        this.logger.warn('NOTIFICATIONS_SERVICE_URL no está definida: no se envían avisos a notifications-service.');
      }
      return;
    }
    try {
      const controller = new AbortController();
      const limite = setTimeout(() => controller.abort(), 1500);
      try {
        const { token } = ctx;
        const respuesta = await fetch(`${base}/v1/notifications`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            eventType: aviso.evento,
            sourceService: SERVICIO,
            relatedEntityType: ENTIDAD[aviso.evento],
            relatedEntityId: aviso.payload.relatedEntityId,
            ...(aviso.recipientUserId ? { recipientUserId: aviso.recipientUserId } : {}),
            ...(aviso.recipientRole ? { recipientRole: aviso.recipientRole } : {}),
            title: aviso.payload.title,
            message: aviso.payload.message,
            priority: 'info',
          }),
          signal: controller.signal,
        });
        if (!respuesta.ok) {
          this.logger.warn(`Aviso ${aviso.evento} rechazado: HTTP ${respuesta.status}`);
        }
      } finally {
        clearTimeout(limite);
      }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Aviso no enviado (${aviso.evento}): ${motivo}`);
    }
  }
}
