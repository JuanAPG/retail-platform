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
export const getZonas = () => apiClient.get<Zona[]>('/zonas').then((r) => r.data);
export const getMunicipios = () => apiClient.get<Municipio[]>('/municipios').then((r) => r.data);

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
  apiClient.get<CategoriaProducto[]>('/categorias-producto').then((r) => r.data);
export const getUnidadesMedida = () =>
  apiClient.get<UnidadMedida[]>('/unidades-medida').then((r) => r.data);
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
  apiClient.post<Producto>('/productos/alta-directa', payload).then((r) => r.data);

export const actualizarProducto = (id: string, payload: ActualizarProductoPayload) =>
  apiClient.patch<Producto>(`/productos/${id}`, payload).then((r) => r.data);

export const eliminarProducto = (id: string) =>
  apiClient.delete<void>(`/productos/${id}`).then((r) => r.data);

export interface CrearPresentacionPayload {
  nombre: string;
  contenido: number;
  unidadMedida: string;
  codigoBarras?: string;
  esPredeterminada?: boolean;
}

export const getPresentaciones = (productoId: string) =>
  apiClient
    .get<ProductoPresentacion[]>(`/productos/${productoId}/presentaciones`)
    .then((r) => r.data);

export const agregarPresentacion = (productoId: string, payload: CrearPresentacionPayload) =>
  apiClient
    .post<ProductoPresentacion>(`/productos/${productoId}/presentaciones`, payload)
    .then((r) => r.data);

export const eliminarPresentacion = (id: string) =>
  apiClient.delete<void>(`/presentaciones/${id}`).then((r) => r.data);
