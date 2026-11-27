import { Injectable, Logger } from '@nestjs/common';

/** Nombre de este microservicio para el campo `service` del registro. */
const SERVICIO = 'algorithms-core';

/**
 * Fuente de las corridas de algorithms-core en data-governance-service: las ventas confirmadas y
 * sus canastas, que son de core-process (contrato de data-governance, "Qué registra cada servicio").
 */
export const FUENTE_VENTAS = 'ventas-core-process';

/** Una corrida completada, con la foto de los datos que usó (D-15). */
export interface CorridaParaLinaje {
  /** Id de la corrida en este servicio (DG-4): UUID de Mongo o de Postgres. */
  runId: string;
  /** SHA-256 de la foto de los datos: es la versión de la fuente (DG-2). */
  foto: string;
  /** Una línea para el árbol de origen; se corta a 300 caracteres. */
  descripcion: string;
  /** Cuándo se produjo la corrida. */
  fecha: Date;
}

/**
 * Linaje de cada corrida (D-43): `POST {DATA_GOVERNANCE_SERVICE_URL}/v1/lineage` con
 * `resourceType: "corrida"`, fuente `ventas-core-process` y la foto como versión.
 *
 * Mismo patrón que `AuditReporter` y `NotificationsReporter`: después de guardar la corrida, con
 * el `Authorization` de quien la lanzó (el registro queda a su nombre, DG-6), corte a los 1.5 s y
 * ningún error sube. Sin la variable no se registra nada. El registro es idempotente en
 * data-governance (DG-3): reenviar la misma corrida da 200, no un duplicado.
 */
@Injectable()
export class LineageReporter {
  private readonly logger = new Logger(LineageReporter.name);

  async registrar(corrida: CorridaParaLinaje, token?: string, correlacion?: string): Promise<void> {
    const base = process.env.DATA_GOVERNANCE_SERVICE_URL;
    if (!base) return;
    try {
      const controller = new AbortController();
      const limite = setTimeout(() => controller.abort(), 1500);
      try {
        const respuesta = await fetch(`${base}/v1/lineage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
            ...(correlacion ? { 'X-Correlation-Id': correlacion } : {}),
          },
          body: JSON.stringify(cuerpoDeLinaje(corrida)),
          signal: controller.signal,
        });
        if (!respuesta.ok) {
          this.logger.warn(`Linaje rechazado (corrida ${corrida.runId}): HTTP ${respuesta.status}`);
        }
      } finally {
        clearTimeout(limite);
      }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Linaje no registrado (corrida ${corrida.runId}): ${motivo}`);
    }
  }
}

/** El cuerpo de `POST /v1/lineage` (contrato de data-governance, DG-3 y DG-4). */
export function cuerpoDeLinaje(corrida: CorridaParaLinaje) {
  return {
    service: SERVICIO,
    resourceType: 'corrida',
    resourceId: corrida.runId,
    description: corrida.descripcion.slice(0, 300),
    source: { key: FUENTE_VENTAS, version: corrida.foto },
    occurredAt: corrida.fecha.toISOString(),
  };
}
