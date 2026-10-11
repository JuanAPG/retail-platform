import { Injectable, Logger } from '@nestjs/common';

/** Nombre de este microservicio para el campo `servicio` del evento. */
const SERVICIO = 'catalog-service';

/**
 * Reporta eventos a audit-service SIN romper nunca la operación que los
 * origina: timeout corto, todo error se traga y se deja en Logger.
 * Contrato: `POST {AUDIT_SERVICE_URL}/v1/auditoria` (docs/contratos/audit-service.md).
 *
 * `POST /v1/auditoria` exige sesión válida: hay que REENVIAR el
 * `Authorization` de quien originó el evento (nunca inventar uno propio
 * ni mandar `usuarioId`/`rolId` en el cuerpo, que ya no los acepta).
 */
@Injectable()
export class AuditReporter {
  private readonly logger = new Logger(AuditReporter.name);

  async reportar(
    evento: {
      tabla: string;
      registroId?: string | null;
      accion:
        | 'insert'
        | 'update'
        | 'delete'
        | 'login'
        | 'importacion'
        | 'aprobar'
        | 'rechazar'
        | 'desactivar'
        | 'ejecutar_corrida'
        | 'simular'
        | 'generar_recomendacion'
        | 'exportar';
      descripcion?: string | null;
      cambios?: Array<{ campo: string; previo?: string | null; posterior?: string | null }>;
      ip?: string | null;
    },
    token?: string,
  ): Promise<void> {
    const base = process.env.AUDIT_SERVICE_URL;
    if (!base) return;
    try {
      const controller = new AbortController();
      const limite = setTimeout(() => controller.abort(), 1500);
      try {
        await fetch(`${base}/v1/auditoria`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ ...evento, servicio: SERVICIO }),
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
