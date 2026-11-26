import { pedir } from './httpClient';
import { asList, bool, num, numberOrNull, text, textOrNull } from './xml';

/*
 * income-segmentation-service (3112, D-35). Contrato: docs/contratos/income-segmentation-service.md,
 * XSD income-segmentation-service.xsd (namespace segmentation/v1).
 * Lectura: los 6 perfiles internos. Escritura (POST/PATCH/DELETE): Analista comercial.
 * Editar NO cambia el segmento en su lugar: PATCH crea una versión nueva y la anterior se
 * conserva (D-35). El `code` no se edita (mandarlo en PATCH → 400).
 * El servicio no lee XML de entrada: los cuerpos van en JSON.
 */

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
  version: number;
  versionValidFrom: string;
}

export interface SegmentVersion {
  segmentId: number;
  version: number;
  name: string;
  incomeRangeMin: number;
  incomeRangeMax: number | null;
  source: string;
  updateFrequency: string;
  zoneRelation: string;
  limitations: string;
  description: string | null;
  validFrom: string;
  validTo: string | null;
  current: boolean;
  createdBy: string | null;
  changeReason: string | null;
}

/** Cuerpo de POST /v1/segments (crea la versión 1). */
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

/** Cuerpo de PATCH /v1/segments/:id (nueva versión): sin `code`, con `changeReason` opcional. */
export type SegmentVersionInput = Partial<Omit<SegmentInput, 'code'>> & { changeReason?: string };

export function parseSegment(s: any): Segment {
  return {
    id: num(s.id),
    code: text(s.code),
    name: text(s.name),
    incomeRangeMin: num(s.incomeRangeMin),
    incomeRangeMax: numberOrNull(s.incomeRangeMax),
    source: text(s.source),
    updateFrequency: text(s.updateFrequency),
    zoneRelation: text(s.zoneRelation),
    limitations: text(s.limitations),
    description: textOrNull(s.description),
    version: num(s.version),
    versionValidFrom: text(s.versionValidFrom),
  };
}

export function parseSegmentVersion(v: any): SegmentVersion {
  return {
    segmentId: num(v.segmentId),
    version: num(v.version),
    name: text(v.name),
    incomeRangeMin: num(v.incomeRangeMin),
    incomeRangeMax: numberOrNull(v.incomeRangeMax),
    source: text(v.source),
    updateFrequency: text(v.updateFrequency),
    zoneRelation: text(v.zoneRelation),
    limitations: text(v.limitations),
    description: textOrNull(v.description),
    validFrom: text(v.validFrom),
    validTo: textOrNull(v.validTo),
    current: bool(v.current),
    createdBy: textOrNull(v.createdBy),
    changeReason: textOrNull(v.changeReason),
  };
}

export function parseSegmentPage(root: any): { segmentos: Segment[]; total: number } {
  return { segmentos: asList(root?.data?.item).map(parseSegment), total: Number(root?.total ?? 0) };
}

export async function listSegments(): Promise<Segment[]> {
  const all: Segment[] = [];
  for (let page = 1; ; page += 1) {
    const { segmentos, total } = parseSegmentPage(
      await pedir({ servicio: 'segmentation', ruta: 'v1/segments', params: { page, limit: 100 }, raiz: 'segmentListResponse' }),
    );
    all.push(...segmentos);
    if (all.length >= total || segmentos.length === 0) return all;
  }
}

/** Historial de versiones de un segmento, la más reciente primero. */
export async function listVersions(id: number): Promise<SegmentVersion[]> {
  const all: SegmentVersion[] = [];
  for (let page = 1; ; page += 1) {
    const root = await pedir({
      servicio: 'segmentation',
      ruta: `v1/segments/${id}/versions`,
      params: { page, limit: 100 },
      raiz: 'segmentVersionListResponse',
    });
    const items = asList(root?.data?.item).map(parseSegmentVersion);
    all.push(...items);
    if (all.length >= Number(root?.total ?? 0) || items.length === 0) return all;
  }
}

export async function createSegment(input: SegmentInput): Promise<Segment> {
  return parseSegment(
    await pedir({ servicio: 'segmentation', metodo: 'POST', ruta: 'v1/segments', json: input, raiz: 'segmentResponse' }),
  );
}

/** Crea una versión nueva (si algo cambió). Nunca manda `code`. */
export async function versionSegment(id: number, input: SegmentVersionInput): Promise<Segment> {
  const { ...cuerpo } = input as Record<string, unknown>;
  delete cuerpo.code;
  return parseSegment(
    await pedir({ servicio: 'segmentation', metodo: 'PATCH', ruta: `v1/segments/${id}`, json: cuerpo, raiz: 'segmentResponse' }),
  );
}

/** 204 sin cuerpo. 409 si alguna zona está o estuvo clasificada con el segmento. */
export async function deleteSegment(id: number): Promise<void> {
  await pedir({ servicio: 'segmentation', metodo: 'DELETE', ruta: `v1/segments/${id}`, raiz: null });
}
