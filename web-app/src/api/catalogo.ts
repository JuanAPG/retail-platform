import { apiClient } from './client';
import { Tienda, Zona, Municipio, CategoriaProducto, Producto, Proveedor } from '../types';

// Los usuarios viven en api/usuarios.ts junto con su CRUD.

export const getTiendas = () => apiClient.get<Tienda[]>('/tiendas').then((r) => r.data);
export const getZonas = () => apiClient.get<Zona[]>('/zonas').then((r) => r.data);
export const getMunicipios = () => apiClient.get<Municipio[]>('/municipios').then((r) => r.data);
export const getCategorias = () =>
  apiClient.get<CategoriaProducto[]>('/categorias-producto').then((r) => r.data);
export const getProductos = () => apiClient.get<Producto[]>('/productos').then((r) => r.data);
export const getProveedores = () =>
  apiClient.get<Proveedor[]>('/proveedores').then((r) => r.data);
