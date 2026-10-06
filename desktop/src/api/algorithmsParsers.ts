import { asList, nullIfEmpty, text } from './xml';

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

function numberOrNull(value: unknown): number | null {
  const v = nullIfEmpty(value as any);
  if (v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function textOrNull(value: unknown): string | null {
  const v = nullIfEmpty(value as any);
  return v === null ? null : text(v);
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