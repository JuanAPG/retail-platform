import axios from 'axios';
import { AuthUser } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export const apiClient = axios.create({
  baseURL: API_URL,
});

// --- Almacenamiento de la sesión -------------------------------------
// Centralizado aquí para que el interceptor y el AuthContext usen
// exactamente las mismas llaves; antes estaban repetidas como strings
// sueltos en dos archivos y bastaba una falta de ortografía para dejar
// media sesión huérfana en localStorage.

const TOKEN_KEY = 'accessToken';
const REFRESH_KEY = 'refreshToken';
const USUARIO_KEY = 'usuario';

export function leerToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function guardarSesion(
  accessToken: string,
  refreshToken: string,
  usuario: AuthUser,
): void {
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

// --- Interceptores ---------------------------------------------------

apiClient.interceptors.request.use((config) => {
  const token = leerToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Rutas donde un 401 significa "credenciales incorrectas", no "tu sesión
// expiró": ahí el error lo muestra el formulario y NO se debe tocar la
// sesión ni redirigir.
const RUTAS_SIN_SESION = ['/auth/login', '/auth/register/proveedor', '/auth/refresh'];

// Si el access token expiró (401), se limpia la sesión y se manda a
// /login. La rotación automática con el refresh token queda como
// mejora futura; por ahora es explícita y simple.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url ?? '';
    const esRutaSinSesion = RUTAS_SIN_SESION.some((ruta) => url.startsWith(ruta));

    if (error.response?.status === 401 && !esRutaSinSesion) {
      limpiarSesion();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);
