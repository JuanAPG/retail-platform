import { API_BASE_URL, httpClient } from './httpClient';
import { unwrap } from './xml';
import {
  Rule,
  RunDetail,
  RunPage,
  parseRunDetail,
  parseRunPage,
  parseRules,
} from './algorithmsParsers';

const ALGORITHMS_URL = import.meta.env.VITE_ALGORITHMS_BASE_URL ?? deriveUrl(3105);

function deriveUrl(port: number): string {
  try {
    const url = new URL(API_BASE_URL);
    url.port = String(port);
    return url.toString();
  } catch {
    return `http://localhost:${port}/`;
  }
}

export interface AprioriParams {
  minSupport: number;
  minConfidence: number;
  maxItemsetSize?: number;
  zoneId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function runApriori(params: AprioriParams): Promise<Rule[]> {
  const body: Record<string, unknown> = {
    minSupport: params.minSupport,
    minConfidence: params.minConfidence,
  };
  if (params.maxItemsetSize) body.maxItemsetSize = params.maxItemsetSize;
  if (params.zoneId) body.zoneId = params.zoneId;
  if (params.dateFrom) body.dateFrom = params.dateFrom;
  if (params.dateTo) body.dateTo = params.dateTo;

  const res = await httpClient.post('v1/association/apriori/run', body, { baseURL: ALGORITHMS_URL });
  return parseRules(unwrap(res.data));
}

export async function listRuns(page = 1, limit = 20): Promise<RunPage> {
  const res = await httpClient.get('v1/association/runs', {
    baseURL: ALGORITHMS_URL,
    params: { page, limit },
  });
  return parseRunPage(unwrap(res.data));
}

export async function getRun(id: string): Promise<RunDetail> {
  const res = await httpClient.get(`v1/association/runs/${id}`, { baseURL: ALGORITHMS_URL });
  return parseRunDetail(unwrap(res.data));
}