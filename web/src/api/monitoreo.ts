import { monitoringApi } from './client';

/** monitoring-service (3120, T-09, D-44). Contrato: docs/contratos/monitoring-service.md */
export type EstadoServicio = 'operativo' | 'degradado' | 'caido' | 'sin_datos';
export type EstadoDependencia = 'ok' | 'no configurado' | 'error';

export interface Dependencia {
  name: string;
  status: EstadoDependencia;
  latencyMs: number | null;
}

export interface SondeoServicio {
  service: string;
  port: number;
  version: string | null;
  status: EstadoServicio;
  checkedAt: string | null;
  latencyMs: number | null;
  probeErrorsConsecutive: number;
  dependencies: Dependencia[];
}

export interface PaginaSondeos {
  data: SondeoServicio[];
  total: number;
  page: number;
  limit: number;
}

/** Último sondeo de los 20 servicios (incluido el monitor). Solo Administrador. */
export const getEstadoServicios = () =>
  monitoringApi.get<{ data: SondeoServicio[] }>('/monitoring/services').then((r) => r.data.data ?? []);

/** Sondeos de las últimas 24 h de un servicio, más recientes primero. */
export const getHistorialServicio = (servicio: string, page = 1, limit = 20) =>
  monitoringApi
    .get<PaginaSondeos>(`/monitoring/services/${encodeURIComponent(servicio)}/history`, { params: { page, limit } })
    .then((r) => r.data);
