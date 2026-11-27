import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { NOMBRE_SERVICIO, Servicio, urlServicio } from '../config/servicios';
import { NAMESPACE, XmlInvalidoError, construirXml, errorDesdeXml, exigirRaiz, leerXml } from './xml';

/**
 * Cliente HTTP único de la app de escritorio (XML exclusivo, CLAUDE.md).
 *
 * - Pide SIEMPRE XML (`Accept: application/xml`) y comprueba la raíz y el namespace del
 *   contrato en cada respuesta (`pedir`). Una respuesta exitosa que no sea XML se rechaza.
 * - ENVÍA XML (`Content-Type: application/xml`) solo donde el contrato del servicio acepta
 *   cuerpos XML. Hoy eso es únicamente transactions-ingestion-service (`objectImport` y el
 *   archivo `salesFile`). auth, catalog, algorithms-core, income-segmentation, decision y
 *   documents NO leen XML de entrada (el contrato de algorithms-core lo dice: "ningún servicio
 *   acepta cuerpos XML"), así que ahí el cuerpo va en JSON y la respuesta en XML. Ver README.
 * - Los errores pueden llegar en XML (`<error>` del filtro de la plantilla) o en JSON
 *   (versiones anteriores, un proxy, o el servicio sin el filtro nuevo): se leen los dos.
 * - Token y renovación: el token lo pone AuthContext; con un 401 se renueva una vez y se
 *   reintenta la petición.
 */

/** Error de un servicio, ya con el cuerpo estándar leído (de XML o de JSON). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details: string[] = [],
    public readonly servicio?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const http = axios.create({
  headers: { Accept: 'application/xml' },
  responseType: 'text',
  // Nada de conversiones automáticas: cada respuesta se lee y se valida aquí.
  transformResponse: [(data) => data],
});

let currentToken: string | null = null;
export function setAuthToken(token: string | null) {
  currentToken = token;
}

http.interceptors.request.use((config) => {
  if (currentToken) config.headers.Authorization = `Bearer ${currentToken}`;
  return config;
});

let refreshHandler: (() => Promise<boolean>) | null = null;
export function setRefreshHandler(handler: () => Promise<boolean>) {
  refreshHandler = handler;
}

let isRefreshing = false;

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const url = original?.url ?? '';
    // login y refresh responden 401 por credenciales o refresh inválidos: ahí no se reintenta.
    const isAuthCall = url.includes('auth/login') || url.includes('auth/refresh');
    if (error.response?.status === 401 && original && !original._retried && refreshHandler && !isRefreshing && !isAuthCall) {
      original._retried = true;
      isRefreshing = true;
      try {
        if (await refreshHandler()) return http(original);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  },
);

function esXml(contentType: string): boolean {
  return /[/+]xml\b/i.test(contentType);
}

function esJson(contentType: string): boolean {
  return /json/i.test(contentType);
}

/** Convierte el cuerpo de una respuesta de error (XML, JSON o nada) en ApiError. */
export function errorDeRespuesta(status: number, contentType: string, cuerpo: string, servicio?: string): ApiError {
  const texto = (cuerpo ?? '').trim();
  const generico = new ApiError(`${servicio ?? 'El servidor'} respondió ${status}.`, status, `HTTP_${status}`, [], servicio);
  if (!texto) return generico;
  try {
    if (esXml(contentType) || texto.startsWith('<')) {
      const e = errorDesdeXml(leerXml(texto));
      return new ApiError(e.message || generico.message, e.statusCode || status, e.code, e.details, servicio);
    }
    if (esJson(contentType) || texto.startsWith('{')) {
      const j = JSON.parse(texto);
      const raw = j?.message;
      const mensaje = Array.isArray(raw) ? raw.join('. ') : typeof raw === 'string' ? raw : generico.message;
      const details = Array.isArray(j?.details) ? j.details.map(String) : Array.isArray(raw) ? raw.map(String) : [];
      return new ApiError(mensaje, Number(j?.statusCode) || status, String(j?.code ?? `HTTP_${status}`), details, servicio);
    }
  } catch {
    // Cuerpo de error ilegible o sin la estructura estándar: se usa el genérico.
  }
  return generico;
}

function aApiError(error: unknown, servicio: string): unknown {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return new ApiError(`No se pudo conectar con ${servicio}. Revisa tu conexión.`, 0, 'NETWORK', [], servicio);
    }
    const r = error.response;
    let cuerpo = r.data as unknown;
    if (cuerpo instanceof ArrayBuffer) cuerpo = new TextDecoder().decode(cuerpo);
    return errorDeRespuesta(r.status, String(r.headers['content-type'] ?? ''), String(cuerpo ?? ''), servicio);
  }
  return error;
}

export interface Peticion {
  servicio: Servicio;
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  ruta: string;
  params?: Record<string, unknown>;
  /** Raíz XML que el contrato declara para la respuesta exitosa. `null` = sin cuerpo (204). */
  raiz: string | null;
  /** Cuerpo JSON (servicios que no leen XML de entrada). */
  json?: unknown;
  /** Cuerpo XML (solo donde el contrato lo acepta): raíz + datos en el orden del XSD. */
  xml?: { raiz: string; datos: Record<string, unknown> };
  /** Archivo adjunto (multipart). */
  formData?: FormData;
}

/** Hace la petición y devuelve el contenido de la raíz XML ya validada (raíz + namespace). */
export async function pedir<T = any>(p: Peticion): Promise<T> {
  const nombre = NOMBRE_SERVICIO[p.servicio];
  const namespace = NAMESPACE[p.servicio];
  const headers: Record<string, string> = {};
  let data: unknown;
  if (p.xml) {
    headers['Content-Type'] = 'application/xml';
    data = construirXml(p.xml.raiz, namespace, p.xml.datos);
  } else if (p.formData) {
    data = p.formData; // el navegador pone el boundary del multipart
  } else if (p.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    data = JSON.stringify(p.json);
  }

  let respuesta;
  try {
    respuesta = await http.request<string>({
      baseURL: urlServicio(p.servicio),
      url: p.ruta,
      method: p.metodo ?? 'GET',
      params: p.params,
      data,
      headers,
    });
  } catch (e) {
    throw aApiError(e, nombre);
  }

  if (p.raiz === null) return undefined as T;
  const contentType = String(respuesta.headers['content-type'] ?? '');
  const texto = String(respuesta.data ?? '');
  if (!esXml(contentType) && !texto.trim().startsWith('<')) {
    throw new ApiError(
      `${nombre} respondió ${contentType || 'sin Content-Type'} en lugar de XML (el escritorio solo acepta XML).`,
      respuesta.status,
      'RESPUESTA_NO_XML',
      [],
      nombre,
    );
  }
  try {
    return exigirRaiz(leerXml(texto), p.raiz, namespace) as T;
  } catch (e) {
    if (e instanceof XmlInvalidoError) {
      throw new ApiError(`Respuesta de ${nombre} fuera de contrato: ${e.message}`, respuesta.status, 'XML_FUERA_DE_CONTRATO', [], nombre);
    }
    throw e;
  }
}

/** Descarga un archivo binario (PDF, Excel, CSV). Los errores se leen igual que en `pedir`. */
export async function descargarArchivo(
  servicio: Servicio,
  ruta: string,
  params?: Record<string, unknown>,
): Promise<{ datos: ArrayBuffer; tipo: string; nombre: string | null }> {
  const nombreServicio = NOMBRE_SERVICIO[servicio];
  try {
    const r = await http.request<ArrayBuffer>({
      baseURL: urlServicio(servicio),
      url: ruta,
      params,
      responseType: 'arraybuffer',
      headers: { Accept: '*/*' },
    });
    const disposicion = String(r.headers['content-disposition'] ?? '');
    const nombre = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposicion)?.[1] ?? null;
    return { datos: r.data, tipo: String(r.headers['content-type'] ?? 'application/octet-stream'), nombre };
  } catch (e) {
    throw aApiError(e, nombreServicio);
  }
}

/** Texto para mostrar de cualquier error. */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detalle = error.details.length > 0 && !error.details.includes(error.message) ? ` (${error.details.join('; ')})` : '';
    return `${error.message}${detalle}`;
  }
  if (axios.isAxiosError(error)) {
    return error.response ? `El servidor respondió ${error.response.status}.` : 'No se pudo conectar con el servidor.';
  }
  if (error instanceof Error) return error.message;
  return 'Ocurrió un error inesperado';
}
