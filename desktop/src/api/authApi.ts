import { pedir } from './httpClient';
import { bool, text } from './xml';

/*
 * auth-service (3101). Contrato: docs/contratos/auth-service.md, XSD auth-service.xsd
 * (namespace auth/v1). auth-service NO lee XML de entrada: el cuerpo va en JSON y la respuesta
 * llega en XML (loginResponse, refreshResponse, validateResponse, logoutResponse).
 */

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

export interface ValidationResult {
  active: boolean;
  user: { id: string; email: string; rol: string; rolId: number } | null;
}

/** Contenido de <loginResponse> → objeto de la app. */
export function parseLogin(r: any): LoginResult {
  const u = r?.usuario ?? {};
  return {
    accessToken: text(r?.accessToken),
    refreshToken: text(r?.refreshToken),
    usuario: {
      id: text(u.id),
      nombre: text(u.nombre),
      email: text(u.email),
      rolId: Number(u.rolId),
      rol: text(u.rol),
      activo: bool(u.activo),
    },
  };
}

export function parseValidate(r: any): ValidationResult {
  const active = bool(r?.active);
  const u = r?.user;
  return {
    active,
    user:
      active && u && typeof u === 'object'
        ? { id: text(u.id), email: text(u.email), rol: text(u.rol), rolId: Number(u.rolId) }
        : null,
  };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  return parseLogin(
    await pedir({ servicio: 'auth', metodo: 'POST', ruta: 'v1/auth/login', json: { email, password }, raiz: 'loginResponse' }),
  );
}

/** auth-service ROTA el par: guardar siempre el refreshToken nuevo. */
export async function refresh(refreshToken: string): Promise<RefreshResult> {
  const r = await pedir({ servicio: 'auth', metodo: 'POST', ruta: 'v1/auth/refresh', json: { refreshToken }, raiz: 'refreshResponse' });
  return { accessToken: text(r.accessToken), refreshToken: text(r.refreshToken) };
}

export async function logout(): Promise<void> {
  await pedir({ servicio: 'auth', metodo: 'POST', ruta: 'v1/auth/logout', raiz: 'logoutResponse' });
}

/** ¿El token sigue vivo (firma + sesión en Redis)? Nunca responde 401: inactivo = `active: false`. */
export async function validateToken(token: string): Promise<ValidationResult> {
  return parseValidate(
    await pedir({ servicio: 'auth', metodo: 'POST', ruta: 'v1/auth/validate', json: { token }, raiz: 'validateResponse' }),
  );
}
