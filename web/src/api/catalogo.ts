import { apiClient } from './client';
import {
  Tienda,
  Zona,
  Municipio,
  CategoriaProducto,
  CodigoPostal,
  Producto,
  ProductoPresentacion,
  Proveedor,
  NuevaPropuestaProducto,
  UnidadMedida,
} from '../types';

// Los usuarios viven en api/usuarios.ts junto con su CRUD.

export const getTiendas = () => apiClient.get<Tienda[]>('/stores').then((r) => r.data);
export const getZonas = () => apiClient.get<Zona[]>('/zones').then((r) => r.data);
export const getMunicipios = () => apiClient.get<Municipio[]>('/municipalities').then((r) => r.data);

// --- M03 Zonas: CRUD + comparación --------------------------------------

export interface CrearZonaPayload {
  nombre: string;
  municipioId: number;
  descripcion?: string;
}

export type ActualizarZonaPayload = Partial<CrearZonaPayload> & { activo?: boolean };

export const crearZona = (payload: CrearZonaPayload) =>
  apiClient.post<Zona>('/zones', payload).then((r) => r.data);

export const actualizarZona = (id: string, payload: ActualizarZonaPayload) =>
  apiClient.patch<Zona>(`/zones/${id}`, payload).then((r) => r.data);

export const eliminarZona = (id: string) =>
  apiClient.delete<void>(`/zones/${id}`).then((r) => r.data);

export interface ZoneComparisonRow {
  zoneId: string;
  zoneName: string;
  municipality: string;
  classification: string | null;
  estimatedIncome: number | null;
  population: number | null;
  availability: number | null;
}

export const compararZonas = (zoneIds: string[]) =>
  apiClient
    .get<ZoneComparisonRow[]>('/zones/compare', { params: { ids: zoneIds.join(',') } })
    .then((r) => r.data);

// --- M02 Tiendas: CRUD -------------------------------------------------

export interface FormatoTienda {
  formato: 'supermercado' | 'minimarket' | 'tienda_conveniencia' | 'mayorista' | 'otro';
}

export interface CrearTiendaPayload {
  nombre: string;
  formato: FormatoTienda['formato'];
  zonaId: string;
  numeroSucursal?: string;
  proveedorId?: string;
  calle: string;
  numeroExterior?: string;
  numeroInterior?: string;
  colonia?: string;
  codigoPostal: string;
}

export type ActualizarTiendaPayload = Partial<CrearTiendaPayload> & { activo?: boolean };

/** Catálogo para el selector de CP del formulario de alta/edición de tienda. */
export const getCodigosPostales = () =>
  apiClient.get<CodigoPostal[]>('/stores/catalog/postal-codes').then((r) => r.data);

export const crearTienda = (payload: CrearTiendaPayload) =>
  apiClient.post<Tienda>('/stores', payload).then((r) => r.data);

export const actualizarTienda = (id: string, payload: ActualizarTiendaPayload) =>
  apiClient.patch<Tienda>(`/stores/${id}`, payload).then((r) => r.data);

export const eliminarTienda = (id: string) =>
  apiClient.delete<void>(`/stores/${id}`).then((r) => r.data);
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
