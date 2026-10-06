import { API_BASE_URL, httpClient } from './httpClient';
import { unwrap } from './xml';
import {
  Municipality,
  Zone,
  ZoneComparison,
  parseComparison,
  parseMunicipalities,
  parseZonePage,
} from './catalogParsers';

/**
 * catalog-service vive en su propio puerto (3102), distinto al de
 * auth-service. Por eso este servicio usa su propia URL base
 * (VITE_CATALOG_BASE_URL) y reutiliza el mismo cliente: así conserva el
 * token, el Accept: application/xml y el reintento por 401.
 */
const CATALOG_URL = import.meta.env.VITE_CATALOG_BASE_URL ?? deriveUrl(3102);

/** Si no hay variable, se asume el mismo host que auth-service pero con otro puerto. */
function deriveUrl(port: number): string {
  try {
    const url = new URL(API_BASE_URL);
    url.port = String(port);
    return url.toString();
  } catch {
    return `http://localhost:${port}/`;
  }
}

const catalog = (path: string, params?: Record<string, unknown>) =>
  httpClient.get(path, { baseURL: CATALOG_URL, params });

/** Trae TODAS las zonas (el servicio pagina; el máximo por página es 100). */
export async function listZones(): Promise<Zone[]> {
  const all: Zone[] = [];
  let page = 1;
  // Se pide página por página hasta completar `total`.
  for (;;) {
    const res = await catalog('v1/zones', { page, limit: 100 });
    const parsed = parseZonePage(unwrap(res.data));
    all.push(...parsed.zones);
    if (all.length >= parsed.total || parsed.zones.length === 0) break;
    page += 1;
  }
  return all;
}

export async function listMunicipalities(): Promise<Municipality[]> {
  const res = await catalog('v1/municipalities');
  return parseMunicipalities(unwrap(res.data));
}

export async function compareZones(ids: string[]): Promise<ZoneComparison[]> {
  const res = await catalog('v1/zones/compare', { ids: ids.join(',') });
  return parseComparison(unwrap(res.data));
}