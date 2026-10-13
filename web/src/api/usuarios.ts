import { authApi, traerTodo } from './client';
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

export const getUsuarios = () => traerTodo<Usuario>(authApi, '/usuarios');

export const getUsuario = (id: string) =>
  authApi.get<Usuario>(`/usuarios/${id}`).then((r) => r.data);

export const getRoles = () => authApi.get<Rol[]>('/roles').then((r) => r.data);

export const crearUsuario = (payload: CrearUsuarioPayload) =>
  authApi.post<Usuario>('/usuarios', payload).then((r) => r.data);

export const actualizarUsuario = (id: string, payload: ActualizarUsuarioPayload) =>
  authApi.patch<Usuario>(`/usuarios/${id}`, payload).then((r) => r.data);

export const eliminarUsuario = (id: string) =>
  authApi.delete<{ mensaje: string; id: string }>(`/usuarios/${id}`).then((r) => r.data);
