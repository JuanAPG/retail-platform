import { authApi, leerToken, leerUsuarioGuardado, renovarSesion } from './client';
import { AuthUser, LoginResponse } from '../types';

export interface RegisterProveedorPayload {
  nombreContacto: string;
  razonSocial: string;
  rfc: string;
  telefono?: string;
  email: string;
  password: string;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await authApi.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

/**
 * Valida contra auth-service que el token guardado siga vigente (firma,
 * lista de revocados y sesión activa en Redis). El servicio no tiene
 * `/auth/me`: `POST /auth/validate` responde `{ active, user }` con id, email
 * y rol, y el nombre se conserva del usuario guardado al iniciar sesión.
 */
export async function me(): Promise<AuthUser> {
  const validar = async (token: string) =>
    (
      await authApi.post<{ active: boolean; user: { id: string; email: string; rol: string } | null }>(
        '/auth/validate',
        { token },
      )
    ).data;

  let token = leerToken();
  if (!token) throw new Error('Sin token');
  let data = await validar(token);
  // El access token dura poco: al recargar con uno vencido se intenta renovar antes de dar la sesión por muerta.
  if (!data.active && (await renovarSesion())) {
    token = leerToken();
    if (token) data = await validar(token);
  }
  if (!data.active || !data.user) throw new Error('Sesión inactiva');
  const guardado = leerUsuarioGuardado();
  return {
    id: data.user.id,
    email: data.user.email,
    rol: data.user.rol,
    nombre: guardado?.id === data.user.id ? guardado.nombre : data.user.email,
    activo: true,
  };
}

/** Cierra la sesión en el servidor (borra Redis y revoca el refresh). Si falla, el cierre local igual procede. */
export async function logoutRemoto(): Promise<void> {
  // El token se lee ya: el llamador limpia la sesión justo después y el interceptor llegaría tarde.
  const token = leerToken();
  if (!token) return;
  try {
    await authApi.post('/auth/logout', null, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // Sin red o sesión ya muerta: el cliente igual limpia lo suyo.
  }
}

export async function registerProveedor(payload: RegisterProveedorPayload) {
  const { data } = await authApi.post('/auth/register/proveedor', payload);
  return data as { mensaje: string; proveedorId: string; usuarioId: string };
}
