import { Injectable, Logger } from '@nestjs/common';

/** Timeout del reporte: la operación que lo origina no debe esperar más. */
const TIMEOUT_MS = 1500;

/**
 * Reporta eventos a audit-service SIN romper nunca la operación que los
 * origina: timeout corto, todo error se traga y se deja en Logger.
 * Contrato: `POST {AUDIT_SERVICE_URL}/v1/auditoria`.
 *
 * Todo fallo queda registrado —falta de configuración, red, timeout y
 * también un no-2xx—: `fetch` no rechaza en 4xx/5xx, así que sin revisar
 * `respuesta.ok` un 400 de validación de audit-service perdía el evento en
 * absoluto silencio y la bitácora quedaba incompleta sin que nadie lo
 * supiera.
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
    const etiqueta = `${evento.tabla}:${evento.accion}`;
    const base = process.env.AUDIT_SERVICE_URL;
    if (!base) {
      this.logger.warn(
        `Auditoría no reportada (${etiqueta}): falta AUDIT_SERVICE_URL en el entorno.`,
      );
      return;
    }

    try {
      const controller = new AbortController();
      const limite = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const respuesta = await fetch(`${base}/v1/auditoria`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(evento),
          signal: controller.signal,
        });
        if (!respuesta.ok) {
          const detalle = await respuesta.text().catch(() => '');
          this.logger.warn(
            `Auditoría rechazada (${etiqueta}): audit-service respondió ` +
              `${respuesta.status} ${detalle.slice(0, 300)}`,
          );
        }
      } finally {
        clearTimeout(limite);
      }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Auditoría no reportada (${etiqueta}): ${motivo}`);
    }
  }
}
