export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  rolId: number;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Rol {
  id: number;
  nombre: string;
  descripcion: string;
}

export interface Proveedor {
  id: string;
  razonSocial: string;
  rfc: string | null;
  contactoNombre: string | null;
  email: string;
  telefono: string | null;
  activo: boolean;
  createdAt: string;
}

export interface Municipio {
  id: number;
  nombre: string;
}

export interface Zona {
  id: string;
  nombre: string;
  municipioId: number;
  municipio: Municipio;
  activo: boolean;
}

export interface Tienda {
  id: string;
  nombre: string;
  direccion: string;
  zonaId: string;
  zona: Zona;
  proveedorId: string | null;
  proveedor: Proveedor | null;
  formato: string;
  numeroSucursal: string | null;
  tieneWebPropia: boolean;
  activo: boolean;
}

export interface CategoriaProducto {
  id: number;
  nombre: string;
  categoriaPadreId: number | null;
  descripcion: string | null;
}

export interface Producto {
  id: string;
  sku: string;
  nombre: string;
  descripcion: string | null;
  categoriaId: number;
  categoria: CategoriaProducto;
  unidadMedida: string;
  esCanastaBasica: boolean;
  estatus: EstatusProducto;
  proveedorId: string | null;
  proveedor: Proveedor | null;
  /** Usuario que resolvió la propuesta; null mientras está pendiente. */
  aprobadoPor: string | null;
  motivoRechazo: string | null;
  createdAt: string;
}

export type EstatusProducto =
  | 'activo'
  | 'pendiente_aprobacion'
  | 'rechazado'
  | 'inactivo';

/** Lo que un Proveedor puede mandar al proponer un alta. */
export interface NuevaPropuestaProducto {
  sku: string;
  nombre: string;
  descripcion?: string;
  categoriaId: number;
  unidadMedida: string;
}

export interface AuthUser {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  usuario: AuthUser;
}

/** Nombres de rol EXACTOS como están sembrados en la tabla roles. */
export type RolNombre =
  | 'Administrador'
  | 'Analista comercial'
  | 'Gerente de categoría'
  | 'Responsable de precios'
  | 'Planeador'
  | 'Auditor'
  | 'Proveedor';
