import { documentsApi } from './client';

/** Un indicador del reporte. `disponible: false` = el servicio dueño no respondió (nunca un 0). */
export interface IndicadorReporte {
  clave: string;
  nombre: string;
  servicio: string;
  disponible: boolean;
  valor: unknown;
  motivo: string | null;
}

export type EstadoReporte = 'generado' | 'exportado';

export interface Reporte {
  id: string;
  tipo: string;
  parametros: { dateFrom: string; dateTo: string; zoneId: string | null; segmentId: number | null };
  formato: string;
  usuarioId: string;
  estado: EstadoReporte;
  creadoEn: string;
  secciones: IndicadorReporte[];
}

export interface PaginaReportes {
  data: Reporte[];
  total: number;
  page: number;
  limit: number;
}

export interface GenerarReportePayload {
  dateFrom: string;
  dateTo: string;
  zoneId?: string;
  segmentId?: number;
}

export const generarReporteEjecutivo = (payload: GenerarReportePayload) =>
  documentsApi.post<Reporte>('/reports/executive', payload).then((r) => r.data);

export const getReportes = (params: { page?: number; limit?: number } = {}) =>
  documentsApi.get<PaginaReportes>('/reports', { params }).then((r) => r.data);

export const getReporte = (id: string) => documentsApi.get<Reporte>(`/reports/${id}`).then((r) => r.data);

/** Descarga el PDF o Excel como archivo; el nombre lo manda el servicio en Content-Disposition. */
export async function exportarReporte(id: string, format: 'pdf' | 'xlsx'): Promise<void> {
  const r = await documentsApi.get<Blob>(`/reports/${id}/export`, { params: { format }, responseType: 'blob' });
  const disposicion = String(r.headers['content-disposition'] ?? '');
  const nombre = /filename="?([^"]+)"?/.exec(disposicion)?.[1] ?? `reporte.${format}`;
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
