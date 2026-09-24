import { apiClient } from './client';
import {
  Tienda,
  Zona,
  Municipio,
  CategoriaProducto,
  Producto,
  ProductoPresentacion,
  Proveedor,
  NuevaPropuestaProducto,
  UnidadMedida,
} from '../types';

// Los usuarios viven en api/usuarios.ts junto con su CRUD.

export const getTiendas = () => apiClient.get<Tienda[]>('/tiendas').then((r) => r.data);
export const getZonas = () => apiClient.get<Zona[]>('/zonas').then((r) => r.data);
export const getMunicipios = () => apiClient.get<Municipio[]>('/municipios').then((r) => r.data);
export const getCategorias = () =>
  apiClient.get<CategoriaProducto[]>('/product-categories').then((r) => r.data);
export const getUnidadesMedida = () =>
  apiClient.get<UnidadMedida[]>('/units').then((r) => r.data);
export const getProductos = () => apiClient.get<Producto[]>('/products').then((r) => r.data);
export const getProveedores = () =>
  apiClient.get<Proveedor[]>('/providers').then((r) => r.data);

// --- Flujo de alta de producto propuesta por un Proveedor ------------
// El backend decide qué devuelve `getProductos` según el rol del token:
// un Proveedor recibe solo los suyos sin necesidad de filtrar aquí.

/** Bandeja de revisión del Gerente de categoría (403 para otros roles). */
export const getProductosPendientes = () =>
  apiClient.get<Producto[]>('/products/pending').then((r) => r.data);

/**
 * Solo Proveedor. El backend asigna la empresa a partir del token.
 * Ruta separada de `crearProductoDirecto` (POST /products, esa es la
 * de Admin/Gerente): son dos flujos de negocio distintos, no el mismo
 * endpoint comportándose diferente según quién llama.
 */
export const proponerProducto = (datos: NuevaPropuestaProducto) =>
  apiClient.post<Producto>('/products/proposals', datos).then((r) => r.data);

export const aprobarProducto = (id: string) =>
  apiClient.patch<Producto>(`/products/${id}/approve`).then((r) => r.data);

export const rechazarProducto = (id: string, motivoRechazo: string) =>
  apiClient
    .patch<Producto>(`/products/${id}/reject`, { motivoRechazo })
    .then((r) => r.data);

// --- M04 Productos: alta directa (Admin/Gerente) + presentaciones ------

export interface CrearProductoDirectoPayload {
  sku: string;
  nombre: string;
  descripcion?: string;
  categoriaId: number;
  esCanastaBasica?: boolean;
  presentacion: string;
  contenido: number;
  unidadMedida: string;
}

export interface ActualizarProductoPayload {
  nombre?: string;
  descripcion?: string;
  categoriaId?: number;
  esCanastaBasica?: boolean;
}

export const crearProductoDirecto = (payload: CrearProductoDirectoPayload) =>
  apiClient.post<Producto>('/products', payload).then((r) => r.data);

export const actualizarProducto = (id: string, payload: ActualizarProductoPayload) =>
  apiClient.patch<Producto>(`/products/${id}`, payload).then((r) => r.data);

export const eliminarProducto = (id: string) =>
  apiClient.delete<void>(`/products/${id}`).then((r) => r.data);

export interface CrearPresentacionPayload {
  nombre: string;
  contenido: number;
  unidadMedida: string;
  codigoBarras?: string;
  esPredeterminada?: boolean;
}

export const getPresentaciones = (productoId: string) =>
  apiClient
    .get<ProductoPresentacion[]>(`/products/${productoId}/presentations`)
    .then((r) => r.data);

export const agregarPresentacion = (productoId: string, payload: CrearPresentacionPayload) =>
  apiClient
    .post<ProductoPresentacion>(`/products/${productoId}/presentations`, payload)
    .then((r) => r.data);

export const eliminarPresentacion = (id: string) =>
  apiClient.delete<void>(`/presentations/${id}`).then((r) => r.data);
