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

export interface EstadisticaMensual {
  usuarioId: string;
  mes: string;
  reportes: number;
}

/** Agregación de Mongo (DOC-03): reportes generados por usuario y mes. Un Proveedor solo ve los suyos. */
export const getEstadisticasReportes = () =>
  documentsApi.get<{ data: EstadisticaMensual[] }>('/reports/stats/by-user-month').then((r) => r.data);

export const generarReporteEjecutivo = (payload: GenerarReportePayload) =>
  documentsApi.post<Reporte>('/reports/executive', payload).then((r) => r.data);

export const getReportes = (params: { page?: number; limit?: number } = {}) =>
  documentsApi.get<PaginaReportes>('/reports', { params }).then((r) => r.data);

export const getReporte = (id: string) => documentsApi.get<Reporte>(`/reports/${id}`).then((r) => r.data);

/** Descarga el PDF o Excel como archivo; el nombre lo manda el servicio en Content-Disposition. */
export async function exportarReporte(id: string, format: FormatoArchivo, creadoEn?: string): Promise<void> {
  const r = await documentsApi.get<Blob>(`/reports/${id}/export`, { params: { format }, responseType: 'blob' });
  const disposicion = String(r.headers['content-disposition'] ?? '');
  // Sin el header (CORS no lo expone si el servicio no lo declara) se arma el mismo nombre que da el servicio.
  const fecha = creadoEn ? creadoEn.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const nombre = /filename="?([^"]+)"?/.exec(disposicion)?.[1] ?? `reporte-ejecutivo-${fecha}.${format}`;
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Archivos privados del reporte (docs/contratos/registro-archivos.md, Parcial 3)
// ---------------------------------------------------------------------------

export type FormatoArchivo = 'pdf' | 'xlsx' | 'csv';
export type EstadoArchivo = 'pendiente' | 'disponible' | 'fallido';

/** Registro del archivo. Nunca trae la URL: esa se pide aparte y dura minutos. */
export interface ArchivoReporte {
  id: string;
  recursoId: string;
  formato: FormatoArchivo;
  estado: EstadoArchivo;
  tamanoBytes: number | null;
  sha256: string | null;
  intentos: number;
  ultimoError: string | null;
  disponibleEn: string | null;
  creadoEn: string;
}

export interface UrlDescarga {
  archivoId: string;
  url: string;
  expiraEn: string;
  ttlSegundos: number;
  nombre: string;
  tamanoBytes: number;
  sha256: string;
}

/** Prepara (o devuelve, si ya existe) el archivo privado del reporte. 201/200 = listo, 202 = se está generando. */
export const prepararArchivo = (reporteId: string, format: FormatoArchivo) =>
  documentsApi.post<ArchivoReporte>(`/reports/${reporteId}/files`, { format }).then((r) => r.data);

export const getArchivos = (reporteId: string) =>
  documentsApi.get<{ data: ArchivoReporte[] }>(`/reports/${reporteId}/files`).then((r) => r.data.data ?? []);

export const getArchivo = (reporteId: string, archivoId: string) =>
  documentsApi.get<ArchivoReporte>(`/reports/${reporteId}/files/${archivoId}`).then((r) => r.data);

export const emitirUrlDescarga = (reporteId: string, archivoId: string) =>
  documentsApi.post<UrlDescarga>(`/reports/${reporteId}/files/${archivoId}/download-url`).then((r) => r.data);

/**
 * Descarga desde la URL firmada en un iframe oculto: el servidor responde
 * `Content-Disposition: attachment` y el navegador guarda el archivo SIN
 * navegar la app (si la URL fallara, la pantalla actual no se pierde).
 * La URL no se guarda ni se copia: vence en minutos y se pide otra cada vez.
 */
export function abrirDescarga(u: Pick<UrlDescarga, 'url' | 'nombre'>): void {
  const marco = document.createElement('iframe');
  marco.style.display = 'none';
  marco.setAttribute('aria-hidden', 'true');
  marco.src = u.url;
  document.body.appendChild(marco);
  // Se retira después: la descarga ya quedó en manos del navegador.
  window.setTimeout(() => marco.remove(), 60_000);
}
