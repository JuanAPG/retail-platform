import { asList, bool, nullIfEmpty, text } from './xml';

/** Tipos que usa la pantalla (planos y limpios, sin rarezas del XML). */
export interface Zone {
  id: string;
  nombre: string;
  municipioId: number;
  municipio: string;
  descripcion: string;
  activo: boolean;
}

export interface Municipality {
  id: number;
  nombre: string;
}

export interface ZonePage {
  zones: Zone[];
  total: number;
  page: number;
  limit: number;
}

export interface ZoneComparison {
  zoneId: string;
  zoneName: string;
  municipality: string;
  classification: string | null;
  estimatedIncome: number | null;
  population: number | null;
  availability: number | string | null;
}

function numberOrNull(value: unknown): number | null {
  const v = nullIfEmpty(value as any);
  if (v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** GET /v1/zones → envoltura paginada { data, total, page, limit } (ver paginacion.md). */
export function parseZonePage(root: any): ZonePage {
  return {
    zones: asList(root.data?.item).map((z: any) => ({
      id: text(z.id),
      nombre: text(z.nombre),
      municipioId: Number(z.municipioId),
      municipio: text(z.municipio?.nombre),
      descripcion: text(z.descripcion),
      activo: bool(z.activo),
    })),
    total: Number(root.total ?? 0),
    page: Number(root.page ?? 1),
    limit: Number(root.limit ?? 20),
  };
}

/** GET /v1/municipalities → arreglo plano (sin paginar), llega como <item>. */
export function parseMunicipalities(root: any): Municipality[] {
  return asList(root.item).map((m: any) => ({ id: Number(m.id), nombre: text(m.nombre) }));
}

/** GET /v1/zones/compare → arreglo plano; los indicadores sin calcular llegan vacíos (null). */
export function parseComparison(root: any): ZoneComparison[] {
  return asList(root.item).map((c: any) => ({
    zoneId: text(c.zoneId),
    zoneName: text(c.zoneName),
    municipality: text(c.municipality),
    classification: nullIfEmpty(c.classification) === null ? null : text(c.classification),
    estimatedIncome: numberOrNull(c.estimatedIncome),
    population: numberOrNull(c.population),
    availability: nullIfEmpty(c.availability),
  }));
}