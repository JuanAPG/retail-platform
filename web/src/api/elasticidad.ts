import { apiClient } from './client';
import {
  ElasticityChartData,
  ElasticityFilters,
  ElasticityParams,
  ElasticityResult,
  SubstitutionPattern,
} from '../types';

/**
 * M11 — Elasticidad y sustitución. Rutas en inglés según el Contrato de
 * Métodos y Endpoints.
 */

/**
 * Quita los campos vacíos: un select sin elegir llega como '' y el
 * backend rechaza `presentationId: ''` con 400. Misma regla que en
 * analitica.ts (M09) y asociacion.ts (M10), donde no está exportada.
 */
function limpiar<T extends object>(datos: T): T {
  return Object.fromEntries(
    Object.entries(datos).filter(([, valor]) => valor !== undefined && valor !== null && valor !== ''),
  ) as T;
}

/** Calcula, clasifica y guarda la corrida. */
export const calcularElasticidad = (params: ElasticityParams) =>
  apiClient.post<ElasticityResult>('/elasticity/calculate', limpiar(params)).then((r) => r.data);

/** Una presentación comparada entre zonas o segmentos. */
export const getGraficoElasticidad = (filtros: ElasticityFilters) =>
  apiClient.get<ElasticityChartData>('/elasticity/chart', { params: limpiar(filtros) }).then((r) => r.data);

/** Pares sustitutos de una categoría. Se calcula al vuelo en el backend. */
export const getPatronesSustitucion = (categoryId: string) =>
  apiClient
    .get<SubstitutionPattern[]>('/substitution/patterns', { params: { categoryId } })
    .then((r) => r.data);
