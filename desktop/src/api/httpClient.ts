import axios, { AxiosError } from 'axios';
import { XMLParser } from 'fast-xml-parser';

/**
 * La app de escritorio PIDE siempre XML (`Accept: application/xml`): lo que
 * recibe y muestra es XML. El cuerpo que ENVÍA va en JSON, porque los
 * servicios (ej. auth-service) solo leen JSON de entrada.
 *
 * Ojo: los ERRORES siempre llegan en JSON aunque se pida XML (los emite
 * HttpErrorFilter, no el XmlInterceptor), así que transformResponse decide
 * según el Content-Type de cada respuesta.
 */
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
});

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3101/';

export const httpClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    Accept: 'application/xml',
    'Content-Type': 'application/json',
  },
  responseType: 'text',
  transformResponse: [
    (data: string, headers) => {
      if (!data || typeof data !== 'string') return data;
      const contentType = String(headers?.['content-type'] ?? '');
      const trimmed = data.trim();
      const looksJson = contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[');
      try {
        return looksJson ? JSON.parse(trimmed) : xmlParser.parse(trimmed);
      } catch {
        return data;
      }
    },
  ],
});

/** El token se setea desde AuthContext después del login; no vive aquí. */
let currentToken: string | null = null;
export function setAuthToken(token: string | null) {
  currentToken = token;
}

httpClient.interceptors.request.use((config) => {
  if (currentToken) {
    config.headers.Authorization = `Bearer ${currentToken}`;
  }
  return config;
});

/** Forma estándar de error de los servicios: {statusCode, message, code, details, path, timestamp}. */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  code?: string;
  details?: unknown;
  path?: string;
  timestamp?: string;
}

export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorBody>;
    const body = axiosError.response?.data as any;
    // Los errores de validación traen `message` como lista de textos.
    const raw = body?.message ?? body?.response?.message;
    if (Array.isArray(raw)) return raw.join('. ');
    if (typeof raw === 'string') return raw;
    if (axiosError.code === 'ERR_NETWORK') {
      return 'No se pudo conectar con el servidor. Revisa tu conexión.';
    }
    return axiosError.message;
  }
  return 'Ocurrió un error inesperado';
}

/**
 * AuthContext registra aquí su función de refresh. Si una petición recibe
 * 401 (access vencido), se renueva el par de tokens y se reintenta UNA vez.
 */
let refreshHandler: (() => Promise<boolean>) | null = null;
export function setRefreshHandler(handler: () => Promise<boolean>) {
  refreshHandler = handler;
}

let isRefreshing = false;

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosError['config'] & { _retried?: boolean }) | undefined;
    const url = original?.url ?? '';
    // login y refresh devuelven 401 por credenciales/refresh inválidos: ahí no se reintenta.
    const isAuthCall = url.includes('auth/login') || url.includes('auth/refresh');

    if (error.response?.status === 401 && original && !original._retried && refreshHandler && !isRefreshing && !isAuthCall) {
      original._retried = true;
      isRefreshing = true;
      try {
        const refreshed = await refreshHandler();
        if (refreshed) {
          return httpClient(original);
        }
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  },
);