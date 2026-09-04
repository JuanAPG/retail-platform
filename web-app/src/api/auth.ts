import { apiClient } from './client';
import { LoginResponse } from '../types';

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

export async function registerProveedor(payload: RegisterProveedorPayload) {
  const { data } = await apiClient.post('/auth/register/proveedor', payload);
  return data as { mensaje: string; proveedorId: string; usuarioId: string };
}
