import { descargarArchivo, pedir } from './httpClient';
import { asList, bool, text, textOrNull } from './xml';

/*
 * documents-service (3108). Contrato: docs/contratos/documents-service.md, XSD documents-service.xsd
 * (namespace documents/v1). Los 6 perfiles internos listan, consultan y exportan; generar un
 * reporte es del Gerente de categoría (no entra al escritorio, D-31). Cada descarga la registra
 * el servicio en audit-service (D-46).
 */

export interface Indicador {
  clave: string;
  nombre: string;
  servicio: string;
  disponible: boolean;
  /** Texto tal cual llegó (en XML el valor es `anyType`; una lista llega anidada). */
  valor: string | null;
  motivo: string | null;
}

export interface Reporte {
  id: string;
  tipo: string;
  dateFrom: string;
  dateTo: string;
  zoneId: string | null;
  segmentId: string | null;
  estado: string;
  usuarioId: string;
  creadoEn: string;
  secciones: Indicador[];
}

/** Valor de un indicador como texto: número, texto o lista resumida (`clave: valor · …`). */
function valorTexto(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'object') return String(v);
  const items = asList((v as any).item ?? v);
  return items
    .map((it: any) =>
      it && typeof it === 'object'
        ? Object.entries(it)
            .map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : x}`)
            .join(' · ')
        : String(it),
    )
    .join(' | ');
}

export function parseReporte(r: any): Reporte {
  const p = r.parametros ?? {};
  return {
    id: text(r.id),
    tipo: text(r.tipo),
    dateFrom: text(p.dateFrom),
    dateTo: text(p.dateTo),
    zoneId: textOrNull(p.zoneId),
    segmentId: textOrNull(p.segmentId),
    estado: text(r.estado),
    usuarioId: text(r.usuarioId),
    creadoEn: text(r.creadoEn),
    secciones: asList(r.secciones?.item).map((s: any) => ({
      clave: text(s.clave),
      nombre: text(s.nombre),
      servicio: text(s.servicio),
      disponible: bool(s.disponible),
      // D-20: un indicador no disponible nunca se muestra como 0.
      valor: bool(s.disponible) ? valorTexto(s.valor) : null,
      motivo: textOrNull(s.motivo),
    })),
  };
}

export async function listarReportes(page = 1, limit = 50): Promise<{ reportes: Reporte[]; total: number }> {
  const r = await pedir({ servicio: 'documents', ruta: 'v1/reports', params: { page, limit }, raiz: 'reportListResponse' });
  return { reportes: asList(r?.data?.item).map(parseReporte), total: Number(r?.total ?? 0) };
}

export async function obtenerReporte(id: string): Promise<Reporte> {
  return parseReporte(await pedir({ servicio: 'documents', ruta: `v1/reports/${id}`, raiz: 'reportResponse' }));
}

export type FormatoReporte = 'pdf' | 'xlsx' | 'csv';

/** GET /v1/reports/:id/export?format=… → el archivo tal cual lo arma el servicio. */
export async function exportarReporte(id: string, format: FormatoReporte) {
  return descargarArchivo('documents', `v1/reports/${id}/export`, { format });
}
