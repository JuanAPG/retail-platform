import { Injectable, Logger } from '@nestjs/common';
import { conCorrelacion } from '../correlation/correlacion';

/** Nombre de este microservicio para el campo `servicio` del evento. */
const SERVICIO = 'availability-service';

export interface EventoAuditoria {
  tabla: string;
  registroId?: string | null;
  accion: 'insert' | 'update' | 'delete';
  descripcion?: string | null;
  cambios?: Array<{ campo: string; previo?: string | null; posterior?: string | null }>;
}

/**
 * Reporta eventos a audit-service SIN romper nunca la operación que los
 * origina (fire-and-forget): timeout corto, todo error se traga y queda en
 * el log. Contrato: `POST {AUDIT_SERVICE_URL}/v1/auditoria`.
 *
 * Se reenvía el `Authorization` de quien originó el evento (audit-service
 * exige sesión válida) y el `X-Correlation-Id` de la operación (T-02).
 */
@Injectable()
export class AuditReporter {
  private readonly logger = new Logger(AuditReporter.name);

  /** No se espera: quien llama sigue de inmediato. */
  reportar(evento: EventoAuditoria, token?: string): void {
    void this.enviar(evento, token);
  }

  private async enviar(evento: EventoAuditoria, token?: string): Promise<void> {
    const base = process.env.AUDIT_SERVICE_URL;
    if (!base) return;
    const controller = new AbortController();
    const limite = setTimeout(() => controller.abort(), 1500);
    try {
      await fetch(`${base}/v1/auditoria`, {
        method: 'POST',
        headers: conCorrelacion({
          'Content-Type': 'application/json',
          ...(token ? { Authorization: token } : {}),
        }),
        body: JSON.stringify({ ...evento, servicio: SERVICIO }),
        signal: controller.signal,
      });
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Auditoría no reportada (${evento.tabla}:${evento.accion}): ${motivo}`);
    } finally {
      clearTimeout(limite);
    }
  }
}
