import { apiClient } from './client';
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
  const { data } = await apiClient.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

/**
 * Valida contra el backend que el token guardado siga vigente y que el
 * usuario siga activo. Se usa al recargar la página para rehidratar la
 * sesión con datos frescos en lugar de confiar en lo que quedó en
 * localStorage.
 */
export async function me(): Promise<AuthUser> {
  const { data } = await apiClient.get<AuthUser>('/auth/me');
  return data;
}

export async function registerProveedor(payload: RegisterProveedorPayload) {
  const { data } = await apiClient.post('/auth/register/proveedor', payload);
  return data as { mensaje: string; proveedorId: string; usuarioId: string };
}
