import { Injectable, Logger } from '@nestjs/common';

/**
 * Reporta eventos a audit-service SIN romper nunca la operación que los
 * origina: timeout corto, todo error se traga y se deja en Logger.
 * El contrato de recepción lo define audit-service en Fase B
 * (`POST {AUDIT_SERVICE_URL}/v1/auditoria`); si aún no existe o no
 * responde, aquí no pasa nada.
 */
@Injectable()
export class AuditReporter {
  private readonly logger = new Logger(AuditReporter.name);

  async reportar(evento: {
    tabla: string;
    registroId?: string | null;
    accion: 'insert' | 'update' | 'delete' | 'login' | 'importacion';
    descripcion?: string | null;
    cambios?: Array<{ campo: string; previo?: string | null; posterior?: string | null }>;
    usuarioId?: string | null;
    rolId?: number | null;
    ip?: string | null;
  }): Promise<void> {
    const base = process.env.AUDIT_SERVICE_URL;
    if (!base) return;
    try {
      const controller = new AbortController();
      const limite = setTimeout(() => controller.abort(), 1500);
      try {
        await fetch(`${base}/v1/auditoria`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(evento),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(limite);
      }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Auditoría no reportada (${evento.tabla}:${evento.accion}): ${motivo}`);
    }
  }
}
