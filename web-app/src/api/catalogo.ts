import { apiClient } from './client';
import {
  Tienda,
  Zona,
  Municipio,
  CategoriaProducto,
  Producto,
  Proveedor,
  NuevaPropuestaProducto,
} from '../types';

// Los usuarios viven en api/usuarios.ts junto con su CRUD.

export const getTiendas = () => apiClient.get<Tienda[]>('/tiendas').then((r) => r.data);
export const getZonas = () => apiClient.get<Zona[]>('/zonas').then((r) => r.data);
export const getMunicipios = () => apiClient.get<Municipio[]>('/municipios').then((r) => r.data);
export const getCategorias = () =>
  apiClient.get<CategoriaProducto[]>('/categorias-producto').then((r) => r.data);
export const getProductos = () => apiClient.get<Producto[]>('/productos').then((r) => r.data);
export const getProveedores = () =>
  apiClient.get<Proveedor[]>('/proveedores').then((r) => r.data);

// --- Flujo de alta de producto propuesta por un Proveedor ------------
// El backend decide qué devuelve `getProductos` según el rol del token:
// un Proveedor recibe solo los suyos sin necesidad de filtrar aquí.

/** Bandeja de revisión del Gerente de categoría (403 para otros roles). */
export const getProductosPendientes = () =>
  apiClient.get<Producto[]>('/productos/pendientes').then((r) => r.data);

/** Solo Proveedor. El backend asigna la empresa a partir del token. */
export const proponerProducto = (datos: NuevaPropuestaProducto) =>
  apiClient.post<Producto>('/productos', datos).then((r) => r.data);

export const aprobarProducto = (id: string) =>
  apiClient.patch<Producto>(`/productos/${id}/aprobar`).then((r) => r.data);

export const rechazarProducto = (id: string, motivoRechazo: string) =>
  apiClient
    .patch<Producto>(`/productos/${id}/rechazar`, { motivoRechazo })
    .then((r) => r.data);
