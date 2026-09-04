import { apiClient } from './client';
import { Rol, Usuario } from '../types';

export interface CrearUsuarioPayload {
  nombre: string;
  email: string;
  password: string;
  rolId: number;
  activo: boolean;
}

/** Todos los campos son opcionales: solo se manda lo que cambió. */
export type ActualizarUsuarioPayload = Partial<CrearUsuarioPayload>;

export const getUsuarios = () => apiClient.get<Usuario[]>('/usuarios').then((r) => r.data);

export const getUsuario = (id: string) =>
  apiClient.get<Usuario>(`/usuarios/${id}`).then((r) => r.data);

export const getRoles = () => apiClient.get<Rol[]>('/roles').then((r) => r.data);

export const crearUsuario = (payload: CrearUsuarioPayload) =>
  apiClient.post<Usuario>('/usuarios', payload).then((r) => r.data);

export const actualizarUsuario = (id: string, payload: ActualizarUsuarioPayload) =>
  apiClient.patch<Usuario>(`/usuarios/${id}`, payload).then((r) => r.data);

export const eliminarUsuario = (id: string) =>
  apiClient.delete<{ mensaje: string; id: string }>(`/usuarios/${id}`).then((r) => r.data);
