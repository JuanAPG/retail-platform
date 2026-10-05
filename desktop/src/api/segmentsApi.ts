import { API_BASE_URL, httpClient } from './httpClient';
import { asList, nullIfEmpty, text, unwrap } from './xml';

const CATALOG_URL = import.meta.env.VITE_CATALOG_BASE_URL ?? deriveUrl(3102);

function deriveUrl(port: number): string {
  try {
    const url = new URL(API_BASE_URL);
    url.port = String(port);
    return url.toString();
  } catch {
    return `http://localhost:${port}/`;
  }
}

export interface Segment {
  id: number;
  code: string;
  name: string;
  incomeRangeMin: number;
  /** null = sin tope superior. */
  incomeRangeMax: number | null;
  source: string;
  updateFrequency: string;
  zoneRelation: string;
  limitations: string;
  description: string | null;
}

export interface SegmentInput {
  code: string;
  name: string;
  incomeRangeMin: number;
  incomeRangeMax?: number;
  source: string;
  updateFrequency: string;
  zoneRelation: string;
  limitations: string;
  description?: string;
}

function numberOrNull(value: unknown): number | null {
  const v = nullIfEmpty(value as any);
  if (v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export function parseSegment(s: any): Segment {
  const description = nullIfEmpty(s.description);
  return {
    id: Number(s.id),
    code: text(s.code),
    name: text(s.name),
    incomeRangeMin: Number(s.incomeRangeMin),
    incomeRangeMax: numberOrNull(s.incomeRangeMax),
    source: text(s.source),
    updateFrequency: text(s.updateFrequency),
    zoneRelation: text(s.zoneRelation),
    limitations: text(s.limitations),
    description: description === null ? null : text(description),
  };
}

export async function listSegments(): Promise<Segment[]> {
  const all: Segment[] = [];
  let page = 1;
  for (;;) {
    const res = await httpClient.get('v1/segments', { baseURL: CATALOG_URL, params: { page, limit: 100 } });
    const root = unwrap(res.data);
    const items = asList(root.data?.item).map(parseSegment);
    all.push(...items);
    if (all.length >= Number(root.total ?? 0) || items.length === 0) break;
    page += 1;
  }
  return all;
}

export async function createSegment(input: SegmentInput): Promise<Segment> {
  const res = await httpClient.post('v1/segments', input, { baseURL: CATALOG_URL });
  return parseSegment(unwrap(res.data));
}

export async function updateSegment(id: number, input: Partial<SegmentInput>): Promise<Segment> {
  const res = await httpClient.patch(`v1/segments/${id}`, input, { baseURL: CATALOG_URL });
  return parseSegment(unwrap(res.data));
}

export async function deleteSegment(id: number): Promise<void> {
  await httpClient.delete(`v1/segments/${id}`, { baseURL: CATALOG_URL });
}