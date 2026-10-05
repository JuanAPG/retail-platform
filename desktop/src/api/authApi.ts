import { httpClient } from './httpClient';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rolId: number;
  rol: string;
  activo: boolean;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  usuario: Usuario;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Cuerpo de la petición en JSON (lo único que auth-service lee de entrada).
 * La respuesta llega en XML, envuelta en <response> por el XmlInterceptor
 * del servidor (no en <loginResponse>), por eso se lee `data.response`.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await httpClient.post('v1/auth/login', { email, password });

  const root = res.data.response ?? res.data;
  const usuario = root.usuario;

  return {
    accessToken: String(root.accessToken),
    refreshToken: String(root.refreshToken),
    usuario: {
      id: String(usuario.id),
      nombre: String(usuario.nombre),
      email: String(usuario.email),
      rolId: Number(usuario.rolId),
      rol: String(usuario.rol),
      activo: usuario.activo === true || usuario.activo === 'true',
    },
  };
}

/** auth-service ROTA el par: guardar siempre el refreshToken nuevo, nunca reutilizar el viejo. */
export async function refresh(refreshToken: string): Promise<RefreshResult> {
  const res = await httpClient.post('v1/auth/refresh', { refreshToken });
  const root = res.data.response ?? res.data;

  return {
    accessToken: String(root.accessToken),
    refreshToken: String(root.refreshToken),
  };
}

/** Protegido con SessionGuard: httpClient ya manda el Authorization con el access token vigente. */
export async function logout(): Promise<void> {
  await httpClient.post('v1/auth/logout');
}

export interface ValidationResult {
  active: boolean;
  user: { id: string; email: string; rol: string; rolId: number } | null;
}

/**
 * Pregunta a auth-service si un token sigue siendo válido (firma + sesión viva en Redis).
 * Nunca responde 401: un token inactivo llega como `active: false`.
 */
export async function validateToken(token: string): Promise<ValidationResult> {
  const res = await httpClient.post('v1/auth/validate', { token });
  const root = res.data.response ?? res.data;
  const active = root.active === true || root.active === 'true';
  const u = root.user;
  return {
    active,
    user:
      active && u && typeof u === 'object'
        ? { id: String(u.id), email: String(u.email), rol: String(u.rol), rolId: Number(u.rolId) }
        : null,
  };
}