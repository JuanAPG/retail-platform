import { authApi, workflowApi } from './client';

/** recommendations-workflow-service (3117, D-41). Contrato: docs/contratos/recommendations-workflow-service.md */
export type EstadoSeguimiento = 'asignada' | 'en_implementacion' | 'implementada' | 'evaluada';
export type Metrica = 'ventas_unidades' | 'ventas_importe' | 'precio_unitario';

export interface Seguimiento {
  id: string;
  recommendationId: string;
  status: EstadoSeguimiento;
  assigneeUserId: string;
  assignedBy: string;
  assignedAt: string;
  dueDate: string | null;
  assignmentNote?: string | null;
  startedAt?: string | null;
  implementedOn?: string | null;
  implementationNote?: string | null;
  evaluatedAt?: string | null;
  evaluation?: { metric: Metrica; unit: string; variationPct: number; before: Periodo; after: Periodo } | null;
}

export interface Periodo {
  from: string;
  to: string;
  value: number;
}

export interface Evaluacion {
  metric: Metrica;
  unit: string;
  scope: { zoneId?: string; storeId?: string; presentationId?: string };
  before: Periodo;
  after: Periodo;
  source: string;
  comment?: string;
}

/** Responsable que el Gerente puede asignar (auth-service, solo id, nombre y rol). */
export interface Asignable {
  id: string;
  nombre: string;
  rol: string;
}

export const getAsignables = () => authApi.get<{ data: Asignable[] }>('/usuarios/asignables').then((r) => r.data.data ?? []);

export const getSeguimientos = () =>
  workflowApi.get<{ data: Seguimiento[]; total: number }>('/workflow/assignments', { params: { limit: 100 } }).then((r) => r.data.data ?? []);

export const asignarSeguimiento = (p: { recommendationId: string; assigneeUserId: string; dueDate?: string; note?: string }) =>
  workflowApi.post<Seguimiento>('/workflow/assignments', p).then((r) => r.data);

export const evaluarSeguimiento = (id: string, e: Evaluacion) =>
  workflowApi.patch<Seguimiento>(`/workflow/assignments/${id}/evaluate`, e).then((r) => r.data);
