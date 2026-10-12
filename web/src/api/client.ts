import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { AuthUser } from '../types';
import { emitirAviso } from './avisos';
import { claseDeError } from './errores';

/**
 * El web es CLIENTE de los 10 microservicios (CLAUDE.md): un cliente axios por
 * servicio, todos bajo `/v1/` y con el mismo manejo de sesión y de errores.
 * La URL de cada uno sale de `VITE_<NOMBRE>_URL`; sin ella, localhost con el
 * puerto del docker-compose (3101–3110).
 */
export const SERVICIOS = {
  auth: { etiqueta: 'auth-service', puerto: 3101, env: 'VITE_AUTH_URL' },
  catalog: { etiqueta: 'catalog-service', puerto: 3102, env: 'VITE_CATALOG_URL' },
  pricing: { etiqueta: 'pricing-service', puerto: 3103, env: 'VITE_PRICING_URL' },
  core: { etiqueta: 'core-process-service', puerto: 3104, env: 'VITE_CORE_URL' },
  algorithms: { etiqueta: 'algorithms-core', puerto: 3105, env: 'VITE_ALGORITHMS_URL' },
  stats: { etiqueta: 'analytics-stats', puerto: 3106, env: 'VITE_STATS_URL' },
  decision: { etiqueta: 'decision-service', puerto: 3107, env: 'VITE_DECISION_URL' },
  documents: { etiqueta: 'documents-service', puerto: 3108, env: 'VITE_DOCUMENTS_URL' },
  notifications: { etiqueta: 'notifications-service', puerto: 3109, env: 'VITE_NOTIFICATIONS_URL' },
  audit: { etiqueta: 'audit-service', puerto: 3110, env: 'VITE_AUDIT_URL' },
  // RESPALDO TEMPORAL: el monolito (congelado) solo se consulta para lo que un microservicio aún no implementa.
  // Acepta los mismos tokens (mismo secreto JWT) y no lleva prefijo /v1.
  monolito: { etiqueta: 'api (monolito)', puerto: 3001, env: 'VITE_MONOLITO_URL' },
} as const;

type NombreServicio = keyof typeof SERVICIOS;

/** Tope por petición: un servicio colgado debe verse como error, no como pantalla en blanco. */
const TIMEOUT_MS = 15000;

function urlBase(nombre: NombreServicio): string {
  const { puerto, env } = SERVICIOS[nombre];
  const configurada = (import.meta.env as Record<string, string | undefined>)[env];
  const base = (configurada ?? `http://localhost:${puerto}`).replace(/\/$/, '');
  return nombre === 'monolito' ? base : `${base}/v1`;
}

// --- Almacenamiento de la sesión -------------------------------------
// Centralizado aquí para que los interceptores y el AuthContext usen
// exactamente las mismas llaves.

const TOKEN_KEY = 'accessToken';
const REFRESH_KEY = 'refreshToken';
const USUARIO_KEY = 'usuario';

export function leerToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function leerRefresh(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function leerUsuarioGuardado(): AuthUser | null {
  try {
    const crudo = localStorage.getItem(USUARIO_KEY);
    return crudo ? (JSON.parse(crudo) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function guardarSesion(accessToken: string, refreshToken: string, usuario: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.setItem(USUARIO_KEY, JSON.stringify(usuario));
}

export function guardarUsuario(usuario: AuthUser): void {
  localStorage.setItem(USUARIO_KEY, JSON.stringify(usuario));
}

export function limpiarSesion(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USUARIO_KEY);
}

// --- Renovación de sesión ---------------------------------------------

// Rutas donde un 401 significa "credenciales incorrectas", no "tu sesión
// expiró": ahí el error lo muestra el formulario y NO se toca la sesión.
const RUTAS_SIN_SESION = ['/auth/login', '/auth/register/proveedor', '/auth/refresh'];

interface ReintentableConfig extends InternalAxiosRequestConfig {
  _reintentado?: boolean;
}

let renovando: Promise<boolean> | null = null;

/** Rota el par de tokens una sola vez aunque fallen varias peticiones a la vez. */
export function renovarSesion(): Promise<boolean> {
  const refreshToken = leerRefresh();
  if (!refreshToken) return Promise.resolve(false);
  if (!renovando) {
    renovando = axios
      .post<{ accessToken: string; refreshToken: string; usuario?: AuthUser }>(
        `${urlBase('auth')}/auth/refresh`,
        { refreshToken },
        { timeout: TIMEOUT_MS },
      )
      .then(({ data }) => {
        const usuario = data.usuario ?? leerUsuarioGuardado();
        if (!usuario) return false;
        guardarSesion(data.accessToken, data.refreshToken, usuario);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        renovando = null;
      });
  }
  return renovando;
}

function expulsar(): void {
  limpiarSesion();
  if (window.location.pathname !== '/login') {
    window.location.href = '/login?motivo=sesion-expirada';
  }
}

function crearCliente(nombre: NombreServicio): AxiosInstance {
  const cliente = axios.create({ baseURL: urlBase(nombre), timeout: TIMEOUT_MS });

  cliente.interceptors.request.use((config) => {
    const token = leerToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  cliente.interceptors.response.use(
    (respuesta) => respuesta,
    async (error: AxiosError) => {
      const config = error.config as ReintentableConfig | undefined;
      const url = config?.url ?? '';
      const esRutaSinSesion = RUTAS_SIN_SESION.some((ruta) => url.startsWith(ruta));

      if (error.response?.status === 401 && !esRutaSinSesion && config) {
        // Un solo reintento: si el token renovado tampoco sirve, la sesión murió.
        if (!config._reintentado && (await renovarSesion())) {
          config._reintentado = true;
          config.headers.Authorization = `Bearer ${leerToken()}`;
          return cliente.request(config);
        }
        expulsar();
        return Promise.reject(error);
      }

      // Solo lo que el usuario no puede corregir ni la pantalla resolver sola
      // sube como aviso global; 400/404/409 los muestra cada formulario.
      const clase = claseDeError(error);
      if (clase === 'red' || clase === 'timeout' || clase === 'servidor' || clase === 'no-disponible') {
        emitirAviso({ servicio: SERVICIOS[nombre].etiqueta, clase });
      } else if (clase === 'prohibido') {
        emitirAviso({ servicio: SERVICIOS[nombre].etiqueta, clase });
      }
      return Promise.reject(error);
    },
  );

  return cliente;
}

/**
 * Los listados de los servicios vienen paginados (`{ data, total, page, limit }`,
 * `limit` máx. 100: docs/contratos/paginacion.md) y las pantallas trabajan con
 * el arreglo completo. Junta las páginas (tope de 20 = 2 000 filas, para que
 * un servicio con datos de más no deje la pantalla cargando para siempre).
 * Solo para endpoints paginados: uno plano rechaza `page`/`limit` con 400.
 */
export async function traerTodo<T>(
  cliente: AxiosInstance,
  url: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const filas: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data } = await cliente.get<{ data: T[]; total: number }>(url, {
      params: { ...params, page, limit: 100 },
    });
    filas.push(...data.data);
    if (filas.length >= data.total || data.data.length === 0) break;
  }
  return filas;
}

export const authApi = crearCliente('auth');
export const catalogApi = crearCliente('catalog');
export const pricingApi = crearCliente('pricing');
export const coreApi = crearCliente('core');
export const algorithmsApi = crearCliente('algorithms');
export const statsApi = crearCliente('stats');
export const decisionApi = crearCliente('decision');
export const documentsApi = crearCliente('documents');
export const notificationsApi = crearCliente('notifications');
export const auditApi = crearCliente('audit');
export const monolitoApi = crearCliente('monolito');
