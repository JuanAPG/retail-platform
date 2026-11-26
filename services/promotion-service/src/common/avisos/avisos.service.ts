import { Injectable, Logger } from '@nestjs/common';
import { conCorrelacion, correlacionActual } from '../correlation/correlacion';

/** Nombre de este servicio en audit-service y notifications-service. */
export const SERVICIO = 'promotion-service';

/** Contrato §14: auditoría y avisos con timeout de 1.5 s. */
const LIMITE_MS = 1500;

/** Lo que queda en `promocion_eventos.auditoria_estado` / `aviso_estado`. */
export type ResultadoEntrega = { estado: 'enviado' | 'fallido' | 'no_aplica'; error: string | null };

export interface EventoAuditoria {
  tabla: 'promociones';
  registroId: string;
  accion: 'insert' | 'aprobar' | 'rechazar';
  descripcion: string;
  cambios?: Array<{ campo: string; previo: string | null; posterior: string | null }>;
}

export interface AvisoNotificacion {
  eventType: 'promocion.propuesta' | 'promocion.resuelta';
  relatedEntityType: 'promocion';
  relatedEntityId: string;
  /**
   * Solo en `promocion.resuelta` (quien propuso). `promocion.propuesta` tiene
   * destino FIJO (rol Responsable de precios): lo pone notifications-service,
   * y mandarle un destinatario responde 400.
   */
  recipientUserId?: string;
  title: string;
  message: string;
  priority: 'info' | 'warning' | 'critical';
}

/**
 * Envía a audit-service y notifications-service. NUNCA lanza: devuelve si
 * se entregó, y quien llama guarda esa evidencia en `promocion_eventos`.
 * Quien llama no lo espera para responder (fire-and-forget, §14).
 *
 * Reenvía el `Authorization` del usuario y el `X-Correlation-Id` (T-02).
 * Si falla deja una línea `WARN aviso_fallido` (sin tokens).
 *
 * ⚠️ Mientras audit-service y notifications-service no agreguen
 * `promotion-service` y sus eventos a sus listas cerradas (dependencia con
 * Juan Ángel, §14), responden 400 y aquí queda `fallido`.
 */
@Injectable()
export class AvisosService {
  private readonly logger = new Logger('avisos');

  auditar(evento: EventoAuditoria, token: string): Promise<ResultadoEntrega> {
    return this.enviar(
      'audit-service',
      process.env.AUDIT_SERVICE_URL,
      '/v1/auditoria',
      { ...evento, servicio: SERVICIO },
      token,
      `${evento.tabla}:${evento.accion}`,
      evento.registroId,
    );
  }

  notificar(aviso: AvisoNotificacion, token: string): Promise<ResultadoEntrega> {
    return this.enviar(
      'notifications-service',
      process.env.NOTIFICATIONS_SERVICE_URL,
      '/v1/notifications',
      { ...aviso, sourceService: SERVICIO },
      token,
      aviso.eventType,
      aviso.relatedEntityId,
    );
  }

  private async enviar(
    destino: string,
    base: string | undefined,
    ruta: string,
    cuerpo: object,
    token: string,
    evento: string,
    entidad: string,
  ): Promise<ResultadoEntrega> {
    if (!base) return { estado: 'no_aplica', error: null };
    const controller = new AbortController();
    const limite = setTimeout(() => controller.abort(), LIMITE_MS);
    let error: string | null = null;
    try {
      const respuesta = await fetch(`${base.replace(/\/$/, '')}${ruta}`, {
        method: 'POST',
        headers: conCorrelacion({ 'Content-Type': 'application/json', Accept: 'application/json', Authorization: token }),
        body: JSON.stringify(cuerpo),
        signal: controller.signal,
      });
      if (respuesta.ok) return { estado: 'enviado', error: null };
      const texto = (await respuesta.text().catch(() => '')).slice(0, 300);
      error = `HTTP ${respuesta.status}${texto ? `: ${texto}` : ''}`;
    } catch (e) {
      error = controller.signal.aborted ? `sin respuesta en ${LIMITE_MS} ms` : e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(limite);
    }
    this.logger.warn(
      JSON.stringify({
        evento: 'aviso_fallido',
        correlationId: correlacionActual() ?? null,
        destino,
        tipo: evento,
        promocionId: entidad,
        motivo: error,
      }),
    );
    return { estado: 'fallido', error };
  }
}
