import { catalogApi, traerTodo } from './client';
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

export interface IndicadoresZonaPayload {
  ingresoEstimado: number;
  poblacion: number;
  disponibilidad: number;
  periodoInicio: string;
  periodoFin: string;
  fuente: string;
}

/** CAT-12 — carga manual de indicadores de una zona (solo Analista comercial). */
export const cargarIndicadoresZona = (zonaId: string, payload: IndicadoresZonaPayload) =>
  catalogApi.put(`/zones/${zonaId}/indicators`, payload).then((r) => r.data);

/** CAT-13 — clasifica la zona en un segmento de ingreso (solo Analista comercial). */
export const clasificarZona = (zonaId: string, segmentId: number) =>
  catalogApi.put(`/zones/${zonaId}/classification`, { segmentId }).then((r) => r.data);

export const getTiendas = () => traerTodo<Tienda>(catalogApi, '/stores');
export const getZonas = () => traerTodo<Zona>(catalogApi, '/zones');
export const getMunicipios = () => catalogApi.get<Municipio[]>('/municipalities').then((r) => r.data);

// --- M03 Zonas: CRUD + comparación --------------------------------------

export interface CrearZonaPayload {
  nombre: string;
  municipioId: number;
  descripcion?: string;
}

export type ActualizarZonaPayload = Partial<CrearZonaPayload> & { activo?: boolean };

export const crearZona = (payload: CrearZonaPayload) =>
  catalogApi.post<Zona>('/zones', payload).then((r) => r.data);

export const actualizarZona = (id: string, payload: ActualizarZonaPayload) =>
  catalogApi.patch<Zona>(`/zones/${id}`, payload).then((r) => r.data);

export const eliminarZona = (id: string) =>
  catalogApi.delete<void>(`/zones/${id}`).then((r) => r.data);

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
  catalogApi
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
  catalogApi.get<CodigoPostal[]>('/stores/catalog/postal-codes').then((r) => r.data);

export const crearTienda = (payload: CrearTiendaPayload) =>
  catalogApi.post<Tienda>('/stores', payload).then((r) => r.data);

export const actualizarTienda = (id: string, payload: ActualizarTiendaPayload) =>
  catalogApi.patch<Tienda>(`/stores/${id}`, payload).then((r) => r.data);

export const eliminarTienda = (id: string) =>
  catalogApi.delete<void>(`/stores/${id}`).then((r) => r.data);
export const getCategorias = () =>
  catalogApi.get<CategoriaProducto[]>('/product-categories').then((r) => r.data);
export const getUnidadesMedida = () =>
  catalogApi.get<UnidadMedida[]>('/units').then((r) => r.data);
export const getProductos = () => traerTodo<Producto>(catalogApi, '/products');
export const getProveedores = () =>
  traerTodo<Proveedor>(catalogApi, '/providers');

// --- Flujo de alta de producto propuesta por un Proveedor ------------
// El backend decide qué devuelve `getProductos` según el rol del token:
// un Proveedor recibe solo los suyos sin necesidad de filtrar aquí.

/** Bandeja de revisión del Gerente de categoría (403 para otros roles). */
export const getProductosPendientes = () =>
  traerTodo<Producto>(catalogApi, '/products/pending');

/**
 * Solo Proveedor. El backend asigna la empresa a partir del token.
 * Ruta separada de `crearProductoDirecto` (POST /products, esa es la
 * de Admin/Gerente): son dos flujos de negocio distintos, no el mismo
 * endpoint comportándose diferente según quién llama.
 */
export const proponerProducto = (datos: NuevaPropuestaProducto) =>
  catalogApi.post<Producto>('/products/proposals', datos).then((r) => r.data);

export const aprobarProducto = (id: string) =>
  catalogApi.patch<Producto>(`/products/${id}/approve`).then((r) => r.data);

export const rechazarProducto = (id: string, motivoRechazo: string) =>
  catalogApi
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
  catalogApi.post<Producto>('/products', payload).then((r) => r.data);

export const actualizarProducto = (id: string, payload: ActualizarProductoPayload) =>
  catalogApi.patch<Producto>(`/products/${id}`, payload).then((r) => r.data);

export const eliminarProducto = (id: string) =>
  catalogApi.delete<void>(`/products/${id}`).then((r) => r.data);

export interface CrearPresentacionPayload {
  nombre: string;
  contenido: number;
  unidadMedida: string;
  codigoBarras?: string;
  esPredeterminada?: boolean;
}

export const getPresentaciones = (productoId: string) =>
  catalogApi
    .get<ProductoPresentacion[]>(`/products/${productoId}/presentations`)
    .then((r) => r.data);

export const agregarPresentacion = (productoId: string, payload: CrearPresentacionPayload) =>
  catalogApi
    .post<ProductoPresentacion>(`/products/${productoId}/presentations`, payload)
    .then((r) => r.data);

export const eliminarPresentacion = (id: string) =>
  catalogApi.delete<void>(`/presentations/${id}`).then((r) => r.data);
