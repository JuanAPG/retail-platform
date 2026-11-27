import { ApiError, pedir } from './httpClient';
import { asList, numberOrNull, text, textOrNull } from './xml';

/*
 * recommendations-workflow-service (3117, D-41). Contrato: docs/contratos/
 * recommendations-workflow-service.md / .xsd, namespace workflow/v1. Acepta cuerpos XML: marcar
 * implementada va como <implementacionRequest>.
 *
 * Desde el escritorio:
 *  - Los 3 perfiles leen la lista, el detalle y el historial.
 *  - Solo el usuario ASIGNADO inicia y marca implementada (`accionesSeguimiento` en config/menu.ts).
 *  - Asignar y evaluar son del Gerente de categoría (web); la evaluación aquí es solo lectura.
 */

export const ESTADOS_SEGUIMIENTO = ['asignada', 'en_implementacion', 'implementada', 'evaluada'] as const;

/** Línea de pasos (D-41): Asignada → En implementación → Implementada → Evaluada. */
export const PASOS: ReadonlyArray<{ estado: string; titulo: string }> = [
  { estado: 'asignada', titulo: 'Asignada' },
  { estado: 'en_implementacion', titulo: 'En implementación' },
  { estado: 'implementada', titulo: 'Implementada' },
  { estado: 'evaluada', titulo: 'Evaluada' },
];

export const NOMBRE_ESTADO_SEGUIMIENTO: Record<string, string> = Object.fromEntries(PASOS.map((p) => [p.estado, p.titulo]));

export const NOMBRE_EVENTO: Record<string, string> = {
  asignada: 'Asignada',
  iniciada: 'Iniciada',
  implementada: 'Marcada implementada',
  evaluada: 'Evaluada',
};

export const NOMBRE_ENTREGA: Record<string, string> = {
  enviado: 'Enviado',
  fallido: 'Falló',
  pendiente: 'Pendiente',
  no_aplica: 'No aplica',
};

export const NOMBRE_METRICA: Record<string, string> = {
  ventas_unidades: 'Ventas en unidades',
  ventas_importe: 'Ventas en importe',
  precio_unitario: 'Precio unitario',
};

/** Posición del estado en la línea de pasos (0 a 3); -1 si no es un estado conocido. */
export function indicePaso(estado: string): number {
  return PASOS.findIndex((p) => p.estado === estado);
}

export interface Periodo {
  from: string;
  to: string;
  value: number | null;
}

export interface Evaluacion {
  metric: string;
  unit: string;
  scope: { zoneId: string | null; storeId: string | null; presentationId: string | null };
  before: Periodo;
  after: Periodo;
  variationPct: number | null;
  source: string;
  comment: string | null;
}

export interface Seguimiento {
  id: string;
  recommendationId: string;
  status: string;
  assigneeUserId: string;
  assignedBy: string;
  assignedAt: string;
  dueDate: string | null;
  assignmentNote: string | null;
  startedAt: string | null;
  implementedOn: string | null;
  implementedAt: string | null;
  implementationNote: string | null;
  evaluatedBy: string | null;
  evaluatedAt: string | null;
  evaluation: Evaluacion | null;
}

export interface EventoSeguimiento {
  event: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string;
  at: string;
  correlationId: string;
  audit: string;
  notification: string;
}

function periodo(p: any): Periodo {
  return { from: text(p?.from), to: text(p?.to), value: numberOrNull(p?.value) };
}

export function parseSeguimiento(s: any): Seguimiento {
  const ev = s?.evaluation;
  return {
    id: text(s?.id),
    recommendationId: text(s?.recommendationId),
    status: text(s?.status),
    assigneeUserId: text(s?.assigneeUserId),
    assignedBy: text(s?.assignedBy),
    assignedAt: text(s?.assignedAt),
    dueDate: textOrNull(s?.dueDate),
    assignmentNote: textOrNull(s?.assignmentNote),
    startedAt: textOrNull(s?.startedAt),
    implementedOn: textOrNull(s?.implementedOn),
    implementedAt: textOrNull(s?.implementedAt),
    implementationNote: textOrNull(s?.implementationNote),
    evaluatedBy: textOrNull(s?.evaluatedBy),
    evaluatedAt: textOrNull(s?.evaluatedAt),
    evaluation:
      ev && typeof ev === 'object'
        ? {
            metric: text(ev.metric),
            unit: text(ev.unit),
            scope: {
              zoneId: textOrNull(ev.scope?.zoneId),
              storeId: textOrNull(ev.scope?.storeId),
              presentationId: textOrNull(ev.scope?.presentationId),
            },
            before: periodo(ev.before),
            after: periodo(ev.after),
            variationPct: numberOrNull(ev.variationPct),
            source: text(ev.source),
            comment: textOrNull(ev.comment),
          }
        : null,
  };
}

/** <seguimientoListResponse> */
export function parseSeguimientos(r: any): { seguimientos: Seguimiento[]; total: number } {
  return { seguimientos: asList(r?.data?.item).map(parseSeguimiento), total: Number(r?.total ?? 0) };
}

/** <historialSeguimientoResponse> (máximo 4 eventos, en orden cronológico). */
export function parseHistorial(r: any): { assignmentId: string; eventos: EventoSeguimiento[] } {
  return {
    assignmentId: text(r?.assignmentId),
    eventos: asList(r?.data?.item).map((e: any) => ({
      event: text(e.event),
      fromStatus: textOrNull(e.fromStatus),
      toStatus: text(e.toStatus),
      actorId: text(e.actorId),
      at: text(e.at),
      correlationId: text(e.correlationId),
      audit: text(e.audit),
      notification: text(e.notification),
    })),
  };
}

/**
 * Un 409 de start/implement (salto o repetición de estado) trae en `details` "estado actual: X"
 * (contrato §7). Devuelve X, o null si el error no lo dice.
 */
export function estadoActualDe409(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  for (const d of e.details) {
    const m = /estado actual:\s*([a-z_]+)/i.exec(d);
    if (m) return m[1];
  }
  return null;
}

/** Texto claro de un 409 de seguimiento, con el estado actual que manda el servidor. */
export function mensajeConflictoSeguimiento(e: unknown): string | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const actual = estadoActualDe409(e);
  const estado = actual ? ` Estado actual: ${NOMBRE_ESTADO_SEGUIMIENTO[actual] ?? actual}.` : '';
  return `${e.message}${estado} Se recargó el seguimiento.`;
}

export const NOTA_MIN = 10;
export const NOTA_MAX = 1000;

/**
 * Cuerpo de <implementacionRequest> en el orden del XSD: implementedOn (opcional, YYYY-MM-DD) y
 * note (10 a 1000 caracteres, obligatoria).
 */
export function cuerpoImplementacion(datos: { implementedOn?: string; note: string }): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {};
  if (datos.implementedOn) cuerpo.implementedOn = datos.implementedOn;
  cuerpo.note = datos.note.trim();
  return cuerpo;
}

export interface FiltrosSeguimiento {
  status?: string;
  /** `mine=true`: solo los asignados al usuario del token (contrato §9). */
  mine?: boolean;
}

/** GET /v1/workflow/assignments (el más reciente primero). */
export async function listarSeguimientos(filtros: FiltrosSeguimiento = {}, page = 1, limit = 100) {
  const params: Record<string, unknown> = { page, limit };
  if (filtros.status) params.status = filtros.status;
  if (filtros.mine) params.mine = 'true';
  return parseSeguimientos(
    await pedir({ servicio: 'workflow', ruta: 'v1/workflow/assignments', params, raiz: 'seguimientoListResponse' }),
  );
}

export async function obtenerSeguimiento(id: string): Promise<Seguimiento> {
  return parseSeguimiento(await pedir({ servicio: 'workflow', ruta: `v1/workflow/assignments/${id}`, raiz: 'seguimientoResponse' }));
}

export async function historialSeguimiento(id: string) {
  return parseHistorial(
    await pedir({ servicio: 'workflow', ruta: `v1/workflow/assignments/${id}/history`, raiz: 'historialSeguimientoResponse' }),
  );
}

/** PATCH /:id/start, sin cuerpo: asignada → en_implementacion. Solo el asignado. */
export async function iniciarSeguimiento(id: string): Promise<Seguimiento> {
  return parseSeguimiento(
    await pedir({ servicio: 'workflow', metodo: 'PATCH', ruta: `v1/workflow/assignments/${id}/start`, raiz: 'seguimientoResponse' }),
  );
}

/** PATCH /:id/implement con cuerpo XML <implementacionRequest>: en_implementacion → implementada. */
export async function marcarImplementada(id: string, datos: { implementedOn?: string; note: string }): Promise<Seguimiento> {
  return parseSeguimiento(
    await pedir({
      servicio: 'workflow',
      metodo: 'PATCH',
      ruta: `v1/workflow/assignments/${id}/implement`,
      xml: { raiz: 'implementacionRequest', datos: cuerpoImplementacion(datos) },
      raiz: 'seguimientoResponse',
    }),
  );
}
