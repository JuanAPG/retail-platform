import { apiClient } from './client';
import { AnalysisRun, AprioriParams, AssociationRule } from '../types';

/**
 * M10 — Reglas de asociación. Rutas en inglés según el Contrato de
 * Métodos y Endpoints.
 */

/**
 * Quita los filtros vacíos: un select sin elegir llega como '' y el
 * backend rechaza `zoneId: ''` con 400. Misma regla que `limpiarFiltros`
 * de analitica.ts (M09), que no está exportada.
 */
function limpiarFiltros(params: AprioriParams): AprioriParams {
  return Object.fromEntries(
    Object.entries(params).filter(([, valor]) => valor !== undefined && valor !== null && valor !== ''),
  ) as unknown as AprioriParams;
}

/** Corre Apriori y guarda la corrida; cada regla trae su `runId`. */
export const correrApriori = (params: AprioriParams) =>
  apiClient.post<AssociationRule[]>('/association/apriori/run', limpiarFiltros(params)).then((r) => r.data);

/** Historial, de la más reciente a la más antigua. Sin reglas. */
export const getCorridas = () => apiClient.get<AnalysisRun[]>('/association/runs').then((r) => r.data);

/** Una corrida completa: parámetros, supuestos, filtros y reglas. */
export const getCorrida = (id: string) =>
  apiClient.get<AnalysisRun>(`/association/runs/${id}`).then((r) => r.data);

/** Valor de un parámetro de la corrida, p. ej. `parametro(run, 'soporte_minimo')`. */
export const parametro = (run: AnalysisRun, clave: string): string | undefined =>
  run.parameters.find((p) => p.key === clave)?.value;
