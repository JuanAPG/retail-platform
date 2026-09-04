import { apiClient } from './client';
import { Usuario, Tienda, Zona, Municipio, CategoriaProducto, Producto, Proveedor } from '../types';

export const getUsuarios = () => apiClient.get<Usuario[]>('/usuarios').then((r) => r.data);
export const getTiendas = () => apiClient.get<Tienda[]>('/tiendas').then((r) => r.data);
export const getZonas = () => apiClient.get<Zona[]>('/zonas').then((r) => r.data);
export const getMunicipios = () => apiClient.get<Municipio[]>('/municipios').then((r) => r.data);
export const getCategorias = () =>
  apiClient.get<CategoriaProducto[]>('/categorias-producto').then((r) => r.data);
export const getProductos = () => apiClient.get<Producto[]>('/productos').then((r) => r.data);
export const getProveedores = () =>
  apiClient.get<Proveedor[]>('/proveedores').then((r) => r.data);
