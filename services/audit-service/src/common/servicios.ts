/**
 * Los 10 microservicios de la plataforma, EXACTAMENTE como cada uno se
 * nombra a sí mismo: es el valor que su `AuditReporter` manda en
 * `servicio` (una constante hardcodeada por servicio) y el mismo
 * `SERVICE_NAME` que fija `infra/docker-compose.yml`.
 *
 * Vive en common/ y es una lista CERRADA a propósito: `servicio` lo
 * declara quien reporta, así que sin acotarlo cualquier sesión válida
 * puede inventar un emisor y contaminar la evidencia que lee el Auditor
 * (RF-30). Mismo criterio que `accion` contra su ENUM.
 *
 * Si se agrega un microservicio, se agrega aquí y en el contrato
 * `docs/contratos/audit-service.md`.
 */
export const SERVICIOS = [
  'auth-service',
  'catalog-service',
  'pricing-service',
  'core-process-service',
  'algorithms-core',
  'analytics-stats',
  'decision-service',
  'documents-service',
  'notifications-service',
  'audit-service',
] as const;

export type NombreServicio = (typeof SERVICIOS)[number];
