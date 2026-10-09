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

/** El municipio no vive aquí directo: se llega por `codigoPostalRef.municipio`. */
export interface CodigoPostal {
  codigoPostal: string;
  municipioId: number;
  municipio: Municipio;
}

export interface Direccion {
  id: string;
  calle: string;
  numeroExterior: string | null;
  numeroInterior: string | null;
  colonia: string | null;
  codigoPostal: string;
  codigoPostalRef: CodigoPostal;
  referencia: string | null;
  latitud: string | null;
  longitud: string | null;
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
  presentationId: string;
  presentationName: string;
  averagePrice: number;
  minPrice: number;
  maxPrice: number;
  storeCount: number;
}

/** Precio normalizado por unidad base (kg, l, pza): hace comparables presentaciones de distinto tamaño. */
export interface ZoneUnitPriceComparison {
  zoneId: string;
  zoneName: string;
  baseUnit: string;
  averagePricePerBaseUnit: number;
  minPricePerBaseUnit: number;
  maxPricePerBaseUnit: number;
  storeCount: number;
}

export interface PriceComparisonResult {
  productId: string;
  zones: ZonePriceComparison[];
  perUnit: ZoneUnitPriceComparison[];
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

/** M06 — Línea de venta: presentación + cantidad + precio congelado. */
export interface TransactionDetail {
  id: string;
  transactionId: string;
  presentationId: string;
  presentation: ProductoPresentacion & { producto: Producto };
  quantity: string;
  unitPrice: string;
  subtotal: string;
}

/** M06 — Encabezado de venta. Una transacción = una canasta (RN-03). */
export interface Transaction {
  id: string;
  folio: string;
  storeId: string;
  store: Tienda;
  fecha: string;
  total: string;
  canal: string;
  importacionId: string | null;
  details: TransactionDetail[];
  createdAt: string;
}

/** M06 — Error de validación del CSV con fila y columna exactas. */
export interface CsvPreviewError {
  fila: number | null;
  columna: string | null;
  codigo: string;
  mensaje: string;
  valorRecibido: string | null;
}

/** M06 — Transacción detectada en el CSV (previa a confirmar). */
export interface CsvPreviewGroup {
  folio: string;
  tienda: string;
  tiendaId: string;
  fecha: string;
  lineas: number;
  totalEstimado: number;
}

/** M06 — Respuesta de POST /transactions/import/preview. */
export interface CsvPreview {
  importacionId: string;
  fileName: string;
  estado: string;
  filasTotales: number;
  filasValidas: number;
  filasConError: number;
  transaccionesDetectadas: number;
  grupos: CsvPreviewGroup[];
  errores: CsvPreviewError[];
}

/** M06 — Respuesta de POST /transactions/import/confirm. */
export interface CsvImportResult {
  importacionId: string;
  estado: string;
  transaccionesCreadas: number;
  canastasCreadas: number;
  omitidos: { folio: string; tienda: string; motivo: string }[];
}

/**
 * M09 — Filtros de los indicadores descriptivos. Mismos nombres que
 * `AnalyticsFilterDto` del backend; todos opcionales.
 */
export interface AnalyticsFilters {
  storeId?: string;
  zoneId?: string;
  segmentId?: number;
  /** ISO `yyyy-mm-dd`. */
  dateFrom?: string;
  /** ISO `yyyy-mm-dd`, inclusivo. */
  dateTo?: string;
}

/** M09 — Una fila de GET /analytics/spend-by-category. */
export interface CategorySpend {
  categoryId: number;
  categoryName: string;
  /** MXN. */
  totalSpend: number;
  units: number;
  /** Canastas que incluyen la categoría. */
  basketCount: number;
  /** Porcentaje del gasto total filtrado, 0–100. */
  share: number;
}

/**
 * M10 — Cuerpo de POST /association/apriori/run. Extiende los filtros de
 * M09, igual que `AprioriParamsDto` en el backend.
 */
export interface AprioriParams extends AnalyticsFilters {
  /** 0.01–1. */
  minSupport: number;
  /** 0–1. */
  minConfidence: number;
  /** 2–4; el backend usa 3 si no viene. */
  maxItemsetSize?: number;
}

/** Corridas de análisis (compartido: M10 hoy, M11–M13 después). */
export type AnalysisRunStatus = 'en_proceso' | 'completada' | 'fallida';

export interface AnalysisRunParameter {
  runId: string;
  key: string;
  /** Siempre texto; se interpreta según la clave. */
  value: string;
}

export interface AnalysisRunAssumption {
  runId: string;
  order: number;
  assumption: string;
}

export interface AnalysisRunFilter {
  runId: string;
  dimension: 'tienda' | 'zona' | 'segmento' | 'categoria' | 'producto';
  referenceId: string;
}

/** M10 — Un producto de un lado de una regla. */
export interface AssociationRuleItem {
  ruleId: string;
  productId: string;
  side: 'antecedente' | 'consecuente';
  product: { id: string; sku: string; nombre: string; categoriaId: number };
}

/** M10 — Regla de asociación de una corrida. */
export interface AssociationRule {
  id: string;
  runId: string;
  /** 0–1. */
  support: number;
  /** 0–1. */
  confidence: number;
  /** > 1 = asociación positiva. */
  lift: number | null;
  /** Canastas que contienen la regla completa. */
  transactionCount: number | null;
  items: AssociationRuleItem[];
}

export interface AnalysisRun {
  id: string;
  type: string;
  status: AnalysisRunStatus;
  userId: string | null;
  /** Solo id y nombre: el backend no expone más del usuario. */
  user: { id: string; nombre: string } | null;
  /** ISO: cuándo se ejecutó. */
  date: string;
  /** `yyyy-mm-dd`: periodo de los DATOS analizados. */
  periodStart: string;
  periodEnd: string;
  transactionsConsidered: number | null;
  basketsConsidered: number | null;
  errorMessage: string | null;
  parameters: AnalysisRunParameter[];
  /** Solo en GET /association/runs/:id. */
  assumptions?: AnalysisRunAssumption[];
  /** Solo en GET /association/runs/:id. */
  filters?: AnalysisRunFilter[];
  /** Reglas; solo en GET /association/runs/:id. */
  results?: AssociationRule[];
}

/** M11 — Cuerpo de POST /elasticity/calculate. Todo opcional. */
export interface ElasticityParams {
  /** Sin ella, todas las presentaciones con ventas en el periodo. */
  presentationId?: string;
  /** ISO `yyyy-mm-dd`. */
  dateFrom?: string;
  /** ISO `yyyy-mm-dd`, inclusivo. */
  dateTo?: string;
  /** Agrupación de las ventas en observaciones; el backend usa 'day' si no viene. */
  granularity?: 'day' | 'week';
}

/** M11 — Clasificación según el contrato. */
export type ElasticityClass = 'elastic' | 'inelastic' | 'unitary';

export interface ElasticityResultItem {
  presentationId: string;
  productName: string;
  presentationName: string;
  /** null = agregado nacional. */
  zoneId: string | null;
  zoneName: string;
  value: number;
  classification: ElasticityClass;
  rSquared: number | null;
  observations: number;
  /** E > 0: la demanda sube con el precio. */
  atypical: boolean;
}

export interface InsufficientElasticity {
  presentationId: string;
  productName: string;
  presentationName: string;
  zoneId: string | null;
  zoneName: string;
  observations: number;
  distinctPrices: number;
  reason: string;
}

/** M11 — Respuesta de POST /elasticity/calculate. */
export interface ElasticityResult {
  runId: string;
  periodStart: string;
  periodEnd: string;
  granularity: 'day' | 'week';
  results: ElasticityResultItem[];
  insufficient: InsufficientElasticity[];
  assumptions: string[];
}

/** M11 — Query de GET /elasticity/chart. */
export interface ElasticityFilters {
  presentationId: string;
  groupBy?: 'zone' | 'segment';
  /** Sin él, la corrida más reciente con resultados de la presentación. */
  runId?: string;
}

/** Todo en null si no hubo datos suficientes. */
export interface ElasticityChartValue {
  value: number | null;
  classification: ElasticityClass | null;
  observations: number;
  rSquared: number | null;
}

export interface ElasticityChartBar extends ElasticityChartValue {
  /** Id de la zona o del segmento. */
  key: string;
  label: string;
  /** Solo por segmento: zonas con datos que se promediaron. */
  zones?: string[];
}

/** M11 — Respuesta de GET /elasticity/chart. */
export interface ElasticityChartData {
  runId: string;
  presentationId: string;
  productName: string;
  presentationName: string;
  groupBy: 'zone' | 'segment';
  /** ISO: cuándo se ejecutó la corrida graficada. */
  executedAt: string;
  granularity: 'day' | 'week';
  periodStart: string;
  periodEnd: string;
  bars: ElasticityChartBar[];
  national: ElasticityChartValue | null;
  note: string;
}

/** M15 — Acciones posibles de un evento de bitácora. */
export type AccionAuditoria = 'insert' | 'update' | 'delete' | 'login' | 'importacion';

/** M15 — Un campo modificado dentro de un evento de auditoría. */
export interface AuditoriaCambio {
  campo: string;
  valorPrevio: string | null;
  valorPosterior: string | null;
}

/** M15 — Un evento de la bitácora (GET /auditoria). */
export interface Auditoria {
  id: string;
  usuarioId: string | null;
  rolId: number | null;
  tablaAfectada: string;
  registroId: string | null;
  accion: AccionAuditoria;
  descripcion: string | null;
  direccionIp: string | null;
  fecha: string;
  cambios: AuditoriaCambio[];
}

/** M15 — Filtros opcionales de GET /auditoria. */
export interface AuditoriaFiltros {
  tabla?: string;
  registroId?: string;
  usuarioId?: string;
  accion?: AccionAuditoria;
  /** ISO `yyyy-mm-dd`. */
  dateFrom?: string;
  /** ISO `yyyy-mm-dd`, inclusivo. */
  dateTo?: string;
  page?: number;
  limit?: number;
}

/** M15 — Respuesta paginada de GET /auditoria. */
export interface AuditoriaPagina {
  data: Auditoria[];
  total: number;
  page: number;
  limit: number;
}

/** M11 — Un par de sustitutos de GET /substitution/patterns. */
export interface SubstitutionPattern {
  originProductId: string;
  originProductName: string;
  targetProductId: string;
  targetProductName: string;
  type: 'precio' | 'preferencia';
  /** 0–1. */
  score: number;
  /** < 1 = se compran juntos menos de lo esperado. */
  lift: number;
  /** Precio de A ↔ comprar B; null si no hubo datos. */
  priceCorrelation: number | null;
  observations: number;
  periodStart: string;
  periodEnd: string;
}
