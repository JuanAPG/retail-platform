import { apiClient } from './client';

/** M13 — Un indicador dentro del resultado de una simulación. */
export interface SimulacionIndicador {
  indicatorKey: string;
  zoneId: string | null;
  baseValue: number;
  simulatedValue: number;
  /** % de variación; null si el valor base es 0. */
  variationPct: number | null;
}

/** M13 — Respuesta de POST /simulation/price y /simulation/presentation. */
export interface ResultadoSimulacion {
  type: 'price' | 'presentation';
  productId: string;
  presentationId: string;
  zoneId: string | null;
  segmentId: number | null;
  inputs: Record<string, unknown>;
  results: SimulacionIndicador[];
  /** Cada simulación se guarda sola como escenario; este es su id. */
  scenarioId: string;
  note?: string;
}

/** M13 — Escenario guardado (GET /simulation/scenarios). */
export interface Escenario {
  id: string;
  nombre: string;
  descripcion: string | null;
  escenarioBaseId: string | null;
  corridaId: string | null;
  zonaId: string | null;
  creadoPor: string;
  createdAt: string;
}

export interface ComparacionEscenariosFila {
  indicatorKey: string;
  zoneId: string | null;
  /** Valor simulado de cada escenario, indexado por su id. */
  valuesByScenario: Record<string, number>;
}

/** M13 — Respuesta de GET /simulation/compare. */
export interface ComparacionEscenarios {
  scenarioIds: string[];
  scenarioNames: Record<string, string>;
  rows: ComparacionEscenariosFila[];
}

export const simularCambioPrecio = (payload: { presentationId: string; zoneId: string; newPrice: number }) =>
  apiClient.post<ResultadoSimulacion>('/simulation/price', payload).then((r) => r.data);

export const simularComparacionPresentaciones = (payload: {
  presentationIdA: string;
  presentationIdB: string;
  zoneId?: string;
}) => apiClient.post<ResultadoSimulacion>('/simulation/presentation', payload).then((r) => r.data);

export const getEscenarios = () => apiClient.get<Escenario[]>('/simulation/scenarios').then((r) => r.data);

export const compararEscenarios = (ids: string[]) =>
  apiClient.get<ComparacionEscenarios>('/simulation/compare', { params: { ids: ids.join(',') } }).then((r) => r.data);
