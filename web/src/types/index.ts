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
  descripcion: string | null;
  activo: boolean;
}

export interface UnidadMedida {
  id: number;
  clave: string;
  nombre: string;
  tipo: string;
}

/** RF-35: un producto tiene varias presentaciones (500 g, 1 kg…). */
export interface ProductoPresentacion {
  id: string;
  productoId: string;
  nombre: string;
  contenido: string;
  unidadMedidaId: number;
  unidadMedida: UnidadMedida;
  esPredeterminada: boolean;
  activo: boolean;
}

export interface Direccion {
  id: string;
  calle: string;
  numeroExterior: string | null;
  numeroInterior: string | null;
  colonia: string | null;
  codigoPostal: string | null;
  municipioId: number;
  municipio: Municipio;
}

export interface Tienda {
  id: string;
  nombre: string;
  direccionId: string;
  /** Normalizada: antes era una sola cadena de texto. */
  direccion: Direccion;
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
  /** El precio y la venta van por presentación, no por producto. */
  presentaciones: ProductoPresentacion[];
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
  /** Primera presentación: se crea junto con el producto (RF-35). */
  presentacion: string;
  contenido: number;
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

/**
 * M08 — Un renglón del histórico de precios. Cuelga de presentación +
 * tienda (RN-06); la zona no viaja aquí, se deriva de `store.zona`.
 */
export interface PriceHistoryEntry {
  id: string;
  presentationId: string;
  presentation?: ProductoPresentacion;
  storeId: string;
  store?: Tienda;
  price: string;
  effectiveDate: string;
  effectiveUntil: string | null;
  vigente: boolean;
  origen: string;
  createdBy: string | null;
  createdAt: string;
}

export interface ZonePriceComparison {
  zoneId: string;
  zoneName: string;
  averagePrice: number;
  minPrice: number;
  maxPrice: number;
  storeCount: number;
}

export interface PriceComparisonResult {
  productId: string;
  zones: ZonePriceComparison[];
}

/**
 * M05 — Segmento de ingreso. A diferencia del resto del catálogo (en
 * español), esta entidad y sus rutas quedaron en inglés porque así las
 * fijó `Contrato_Metodos_Endpoints` para que Leonardo (M09/M11) y
 * Fernando (M07/M12) integraran contra nombres literales.
 */
export interface IncomeSegment {
  id: number;
  code: string;
  name: string;
  incomeRangeMin: string;
  incomeRangeMax: string | null;
  source: string;
  updateFrequency: string;
  zoneRelation: string;
  limitations: string;
  description: string | null;
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
