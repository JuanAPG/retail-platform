import { decisionApi, traerTodo } from './client';

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

/** Tipo de escenario guardado (decision-service). */
export type TipoEscenario = 'precio' | 'presentacion' | 'desconocido';

/** M13 — Una presentación dentro de la comparación (D-14). Los null significan "sin precio": nunca 0. */
export interface PresentacionComparada {
  presentationId: string;
  presentationName: string;
  priceStatus: 'con_precio' | 'sin_precio_en_la_zona' | 'sin_precio_vigente';
  outlay: number | null;
  unitPrice: number | null;
  baseUnit: string;
  estimatedDemand: number | null;
  accessibilityEffect: { incomeSharePct: number | null; unitPricePremiumPct: number | null } | null;
}

/** M13 — Respuesta de POST /simulation/presentation (`PresentationComparisonResult`). */
export interface ComparacionPresentaciones {
  type: 'presentacion';
  scenarioId: string;
  productId: string;
  productName: string;
  zoneId: string | null;
  segmentId: number | null;
  presentations: PresentacionComparada[];
  referencePresentationId: string;
  comparedPresentationId: string;
  results: SimulacionIndicador[];
  assumptions: string[];
  warnings: string[];
}

/** M13 — Escenario guardado (`ScenarioSummary` de GET /simulation/scenarios, paginado). */
export interface Escenario {
  id: string;
  name: string;
  type: TipoEscenario;
  zoneId: string | null;
  productId: string | null;
  presentationId: string | null;
  elasticity: number | null;
  currentPrice: number | null;
  newPrice: number | null;
  baseDemand: number | null;
  presentations: PresentacionComparada[];
  assumptions: string[];
  createdBy: string;
  createdAt: string;
}

/** Un indicador de un escenario dentro de la comparación. */
export interface ResultadoEscenario {
  indicatorKey: string;
  zoneId: string | null;
  baseValue: number;
  simulatedValue: number;
  difference: number;
  variationPct: number | null;
}

/** M13 — Respuesta de GET /simulation/compare (`ScenarioComparison`). */
export interface ComparacionEscenarios {
  scenarioIds: string[];
  scenarios: {
    scenarioId: string;
    name: string;
    type: TipoEscenario;
    zoneId: string | null;
    elasticity: number | null;
    elasticityRunId: string | null;
    results: ResultadoEscenario[];
  }[];
  warnings: string[];
}

export const simularCambioPrecio = (payload: { presentationId: string; zoneId: string; newPrice: number }) =>
  decisionApi.post<ResultadoSimulacion>('/simulation/price', payload).then((r) => r.data);

/** D-14: todas (o al menos 3) presentaciones del MISMO producto; sin `presentationIds` compara todas las activas. */
export const simularComparacionPresentaciones = (payload: { productId: string; zoneId?: string; presentationIds?: string[] }) =>
  decisionApi.post<ComparacionPresentaciones>('/simulation/presentation', payload).then((r) => r.data);

/** La lista viene paginada (`{ data, total, page, limit }`): se traen todas las páginas. */
export const getEscenarios = () => traerTodo<Escenario>(decisionApi, '/simulation/scenarios');

export const compararEscenarios = (ids: string[]) =>
  decisionApi.get<ComparacionEscenarios>('/simulation/compare', { params: { ids: ids.join(',') } }).then((r) => r.data);
