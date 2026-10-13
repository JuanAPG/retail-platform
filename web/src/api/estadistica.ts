import { statsApi } from './client';

/**
 * analytics-stats (RF-16, RF-20, RF-21, RF-22). Contrato: docs/contratos/analytics-stats.md.
 * Las pruebas se calculan al vuelo y no se guardan; las corridas de clustering sí (MongoDB, D3).
 * Comparan grupos agregados (zonas o segmentos), nunca personas.
 */

export interface GrupoValores {
  label: string;
  values: number[];
}

export interface GrupoConteo {
  label: string;
  successes: number;
  total: number;
}

export type MetricaCanastas = 'totalValue' | 'productCount' | 'unitsTotal';
export type CondicionCanastas = 'hasBasicProducts' | 'chica' | 'mediana' | 'grande';

/** Los valores salen de las canastas de core-process: `metric` (hipótesis/ANOVA) o `condition` (proporciones). */
export interface FuenteCanastas {
  metric?: MetricaCanastas;
  condition?: CondicionCanastas;
  groupBy: 'segment' | 'zone';
  groupIds: string[];
  dateFrom?: string;
  dateTo?: string;
  storeId?: string;
}

/** Exactamente uno de `groups` o `baskets` (ninguno o los dos → 400). */
export interface CuerpoPrueba<G> {
  groups?: G[];
  baskets?: FuenteCanastas;
  alpha?: number;
}

export interface CuerpoHipotesis extends CuerpoPrueba<GrupoValores> {
  method?: 'auto' | 'welch' | 'mannwhitney';
  alternative?: 'two-sided' | 'greater' | 'less';
}

export interface ResumenGrupo {
  label: string;
  n: number;
  mean: number;
  median: number;
  standardDeviation: number;
}

export interface ResumenProporcion {
  label: string;
  successes: number;
  total: number;
  proportion: number;
}

/** Campos comunes de toda prueba. */
export interface ResultadoPrueba {
  test: string;
  statistic: number | null;
  pValue: number;
  alpha: number;
  rejectNull: boolean;
  /** En español; siempre como diferencia estadística en estos datos, nunca como causa. */
  conclusion: string;
  source: FuenteCanastas | null;
  assumptions: string[];
  degreesOfFreedom?: number | null;
  dfBetween?: number | null;
  dfWithin?: number | null;
}

export interface ResultadoMedias extends ResultadoPrueba {
  groups: ResumenGrupo[];
  alternative?: string;
}

export interface ResultadoProporciones extends ResultadoPrueba {
  groups: ResumenProporcion[];
  difference?: number | null;
}

export const probarHipotesis = (cuerpo: CuerpoHipotesis) =>
  statsApi.post<ResultadoMedias>('/hypothesis/test', cuerpo).then((r) => r.data);

export const correrAnova = (cuerpo: CuerpoPrueba<GrupoValores>) =>
  statsApi.post<ResultadoMedias>('/anova', cuerpo).then((r) => r.data);

export const compararProporciones = (cuerpo: CuerpoPrueba<GrupoConteo>) =>
  statsApi.post<ResultadoProporciones>('/proportions/compare', cuerpo).then((r) => r.data);

// --- Clustering de zonas (RF-16) ---------------------------------------

export type IndicadorZona = 'estimatedIncome' | 'population' | 'availability' | 'averageTicket';

export interface CuerpoClustering {
  k: number;
  seed?: number;
  features?: IndicadorZona[];
  zoneIds?: string[];
  dateFrom?: string;
  dateTo?: string;
}

export interface CorridaClustering {
  id: string;
  type?: string;
  /** Solo el id: el nombre lo resuelve el cliente (D-26). */
  userId: string;
  date: string;
  parameters: { k: number; seed: number; features: IndicadorZona[]; source: string; dateFrom?: string | null; dateTo?: string | null };
  input?: Array<{ zoneId: string; zoneName: string } & Partial<Record<IndicadorZona, number>>>;
  clusters?: Array<{ cluster: number; size: number; centroid: Partial<Record<IndicadorZona, number>> }>;
  assignments?: Array<{ zoneId: string; zoneName: string; cluster: number }>;
  excludedZones?: Array<{ zoneId: string; zoneName: string; reason: string }>;
  inertia?: number;
  silhouette?: number | null;
  assumptions?: string[];
  /** Solo en el listado. */
  zoneCount?: number;
}

export interface PaginaCorridasClustering {
  data: CorridaClustering[];
  total: number;
  page: number;
  limit: number;
}

export const correrClustering = (cuerpo: CuerpoClustering) =>
  statsApi.post<CorridaClustering>('/clustering/run', cuerpo).then((r) => r.data);

export const getCorridasClustering = (params: { page?: number; limit?: number } = {}) =>
  statsApi.get<PaginaCorridasClustering>('/clustering/runs', { params }).then((r) => r.data);

export const getCorridaClustering = (id: string) =>
  statsApi.get<CorridaClustering>(`/clustering/runs/${id}`).then((r) => r.data);
