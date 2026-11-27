import { asList, bool, boolOrNull, numberOrNull, text, textOrNull } from './xml';

export interface RuleItem {
  productId: string;
  sku: string;
  nombre: string;
  side: 'antecedente' | 'consecuente';
}

export interface Rule {
  id: string;
  runId: string;
  support: number;
  confidence: number;
  lift: number | null;
  transactionCount: number | null;
  items: RuleItem[];
  antecedente: string[];
  consecuente: string[];
}

export interface Run {
  id: string;
  status: string;
  /** `apriori` o `fpgrowth` (parámetro `algoritmo` de la corrida, D2). */
  algoritmo: string;
  userName: string | null;
  date: string;
  periodStart: string | null;
  periodEnd: string | null;
  basketsConsidered: number | null;
  errorMessage: string | null;
  parameters: Record<string, string>;
}

export interface RunFilter {
  dimension: string;
  referenceId: string;
}

export interface RunDetail extends Run {
  assumptions: string[];
  filters: RunFilter[];
  results: Rule[];
}

export interface RunPage {
  runs: Run[];
  total: number;
  page: number;
  limit: number;
}

function flatList(root: any): any[] {
  return Array.isArray(root) ? root : asList(root?.item);
}

export function parseRule(r: any): Rule {
  const items: RuleItem[] = asList(r.items?.item).map((i: any) => ({
    productId: text(i.productId),
    sku: text(i.product?.sku),
    nombre: text(i.product?.nombre),
    side: text(i.side) === 'consecuente' ? 'consecuente' : 'antecedente',
  }));
  return {
    id: text(r.id),
    runId: text(r.runId),
    support: Number(r.support),
    confidence: Number(r.confidence),
    lift: numberOrNull(r.lift),
    transactionCount: numberOrNull(r.transactionCount),
    items,
    antecedente: items.filter((i) => i.side === 'antecedente').map((i) => i.nombre),
    consecuente: items.filter((i) => i.side === 'consecuente').map((i) => i.nombre),
  };
}

export function parseRules(root: any): Rule[] {
  return flatList(root).map(parseRule);
}

export function parseRun(r: any): Run {
  const parameters: Record<string, string> = {};
  for (const p of asList(r.parameters?.item)) parameters[text(p.key)] = text(p.value);
  return {
    id: text(r.id),
    status: text(r.status),
    algoritmo: parameters.algoritmo ?? 'apriori',
    userName: textOrNull(r.user?.nombre),
    date: text(r.date),
    periodStart: textOrNull(r.periodStart),
    periodEnd: textOrNull(r.periodEnd),
    basketsConsidered: numberOrNull(r.basketsConsidered),
    errorMessage: textOrNull(r.errorMessage),
    parameters,
  };
}

export function parseRunPage(root: any): RunPage {
  return {
    runs: asList(root.data?.item).map(parseRun),
    total: Number(root.total ?? 0),
    page: Number(root.page ?? 1),
    limit: Number(root.limit ?? 20),
  };
}

export function parseRunDetail(root: any): RunDetail {
  const assumptions = asList(root.assumptions?.item)
    .slice()
    .sort((a: any, b: any) => Number(a.order) - Number(b.order))
    .map((a: any) => text(a.assumption));
  return {
    ...parseRun(root),
    assumptions,
    filters: asList(root.filters?.item).map((f: any) => ({
      dimension: text(f.dimension),
      referenceId: text(f.referenceId),
    })),
    results: asList(root.results?.item).map(parseRule),
  };
}
// ---------------------------------------------------------------------------------------
// Elasticidad (M11)
// ---------------------------------------------------------------------------------------

export type ClaseElasticidad = 'elastic' | 'inelastic' | 'unitary';

export const NOMBRE_CLASE: Record<string, string> = {
  elastic: 'Elástica',
  inelastic: 'Inelástica',
  unitary: 'Unitaria',
};

export interface ElasticidadResultado {
  presentationId: string;
  productName: string;
  presentationName: string;
  /** null = agregado nacional. */
  zoneId: string | null;
  zoneName: string;
  value: number;
  classification: string;
  rSquared: number | null;
  observations: number;
  atypical: boolean;
}

export interface ElasticidadInsuficiente {
  presentationId: string;
  productName: string;
  presentationName: string;
  zoneId: string | null;
  zoneName: string;
  observations: number;
  distinctPrices: number;
  reason: string;
}

export interface ElasticidadCalculo {
  runId: string;
  periodStart: string;
  periodEnd: string;
  granularity: string;
  results: ElasticidadResultado[];
  insufficient: ElasticidadInsuficiente[];
  assumptions: string[];
}

export interface BarraElasticidad {
  key: string;
  label: string;
  value: number | null;
  classification: string | null;
  observations: number;
  rSquared: number | null;
  atypical: boolean | null;
}

export interface ElasticidadGrafica {
  runId: string;
  presentationId: string;
  productName: string;
  presentationName: string;
  groupBy: string;
  executedAt: string;
  granularity: string;
  periodStart: string;
  periodEnd: string;
  bars: BarraElasticidad[];
  national: { value: number | null; classification: string | null; observations: number | null } | null;
  note: string;
}

export interface ElasticidadVigente extends ElasticidadResultado {
  outdated: boolean;
  runId: string;
  executedAt: string;
  periodStart: string;
  periodEnd: string;
}

function resultado(r: any): ElasticidadResultado {
  return {
    presentationId: text(r.presentationId),
    productName: text(r.productName),
    presentationName: text(r.presentationName),
    zoneId: textOrNull(r.zoneId),
    zoneName: text(r.zoneName),
    value: Number(r.value),
    classification: text(r.classification),
    rSquared: numberOrNull(r.rSquared),
    observations: Number(r.observations),
    atypical: bool(r.atypical),
  };
}

/** <elasticityCalculateResponse> */
export function parseElasticityCalculate(root: any): ElasticidadCalculo {
  return {
    runId: text(root.runId),
    periodStart: text(root.periodStart),
    periodEnd: text(root.periodEnd),
    granularity: text(root.granularity),
    results: asList(root.results?.item).map(resultado),
    insufficient: asList(root.insufficient?.item).map((i: any) => ({
      presentationId: text(i.presentationId),
      productName: text(i.productName),
      presentationName: text(i.presentationName),
      zoneId: textOrNull(i.zoneId),
      zoneName: text(i.zoneName),
      observations: Number(i.observations),
      distinctPrices: Number(i.distinctPrices),
      reason: text(i.reason),
    })),
    assumptions: asList(root.assumptions?.item).map(text),
  };
}

/** <elasticityChartResponse> */
export function parseElasticityChart(root: any): ElasticidadGrafica {
  const n = root.national;
  const national =
    n && typeof n === 'object' && numberOrNull(n.value) !== null
      ? { value: numberOrNull(n.value), classification: textOrNull(n.classification), observations: numberOrNull(n.observations) }
      : null;
  return {
    runId: text(root.runId),
    presentationId: text(root.presentationId),
    productName: text(root.productName),
    presentationName: text(root.presentationName),
    groupBy: text(root.groupBy),
    executedAt: text(root.executedAt),
    granularity: text(root.granularity),
    periodStart: text(root.periodStart),
    periodEnd: text(root.periodEnd),
    bars: asList(root.bars?.item).map((b: any) => ({
      key: text(b.key),
      label: text(b.label),
      value: numberOrNull(b.value),
      classification: textOrNull(b.classification),
      observations: Number(b.observations ?? 0),
      rSquared: numberOrNull(b.rSquared),
      atypical: boolOrNull(b.atypical),
    })),
    national,
    note: text(root.note),
  };
}

/** <currentElasticityListResponse> (paginado) */
export function parseElasticityCurrent(root: any): { filas: ElasticidadVigente[]; total: number } {
  return {
    filas: asList(root?.data?.item).map((r: any) => ({
      ...resultado(r),
      outdated: bool(r.outdated),
      runId: text(r.runId),
      executedAt: text(r.executedAt),
      periodStart: text(r.periodStart),
      periodEnd: text(r.periodEnd),
    })),
    total: Number(root?.total ?? 0),
  };
}
