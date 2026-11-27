/**
 * Único lugar donde se define QUIÉN entra a la app, QUÉ secciones ve cada rol y QUÉ puede
 * hacer dentro de ellas. El login, el menú lateral, las rutas protegidas, la pantalla de
 * inicio y los botones de cada pantalla leen de aquí.
 *
 * Fuentes (en este orden de precedencia, CLAUDE.md):
 *  1. D-31 (docs/matriz-perfiles-permisos.md §4.2): al escritorio entran SOLO el Analista
 *     comercial, el Responsable de precios y el Planeador. Elasticidad: el Analista consulta y
 *     solo el Responsable de precios calcula. Simulación: solo el Planeador simula; el Analista
 *     ve escenarios guardados. Importar ventas, segmentos y asociaciones: Analista comercial.
 *  2. Matriz §3 y §3.2 (lectura de cada módulo).
 *  3. Los contratos de cada servicio (qué rol acepta cada ruta).
 *
 * La UI solo REFLEJA los permisos: cada servicio los vuelve a revisar y responde 403.
 * Los nombres de rol son EXACTOS (con acentos), como los devuelve auth-service.
 */

export const ROL = {
  ADMINISTRADOR: 'Administrador',
  ANALISTA: 'Analista comercial',
  GERENTE: 'Gerente de categoría',
  RESPONSABLE_PRECIOS: 'Responsable de precios',
  PLANEADOR: 'Planeador',
  AUDITOR: 'Auditor',
  PROVEEDOR: 'Proveedor',
  INVESTIGADOR: 'Investigador de mercado',
} as const;

/** D-31: los únicos perfiles que entran a la app de escritorio. */
export const ROLES_ESCRITORIO: readonly string[] = [ROL.ANALISTA, ROL.RESPONSABLE_PRECIOS, ROL.PLANEADOR];

const TODOS = ROLES_ESCRITORIO;
const SOLO_ANALISTA = [ROL.ANALISTA] as const;

/** ¿Este rol puede usar la app de escritorio? (D-31) */
export function rolAdmitido(rol: string | null | undefined): boolean {
  return !!rol && ROLES_ESCRITORIO.includes(rol);
}

/** Texto que ve en el login un perfil que no entra al escritorio. */
export function mensajeAccesoNoPermitido(rol: string): string {
  return (
    `Acceso no permitido: tu perfil (${rol}) no usa la aplicación de escritorio. ` +
    'Esta aplicación es para Analista comercial, Responsable de precios y Planeador (D-31).'
  );
}

/**
 * Acciones de escritura o cálculo dentro de las pantallas. La consulta de cada sección la
 * da `roles` del menú; esto es lo que además habilita botones.
 */
export const ACCIONES = {
  /** POST /v1/association/{apriori,fpgrowth}/run: Analista comercial (contrato algorithms-core, D-31). */
  ejecutarAsociacion: SOLO_ANALISTA,
  /** POST /v1/elasticity/calculate: solo Responsable de precios (D-31, contrato algorithms-core). */
  calcularElasticidad: [ROL.RESPONSABLE_PRECIOS],
  /** POST/PATCH/DELETE /v1/segments: Analista comercial (D-31, Matriz §3.2 M05 = T). */
  editarSegmentos: SOLO_ANALISTA,
  /** POST /v1/simulation/{price,presentation}: solo el Planeador (D-31, Matriz M13 = T). */
  simular: [ROL.PLANEADOR],
  /** POST/confirm/DELETE /v1/transaction-imports: el Analista crea, confirma y descarta (contrato 3111). */
  importarVentas: SOLO_ANALISTA,
} as const satisfies Record<string, readonly string[]>;

export type Accion = keyof typeof ACCIONES;

export function puede(rol: string | null | undefined, accion: Accion): boolean {
  return !!rol && (ACCIONES[accion] as readonly string[]).includes(rol);
}

export interface MenuItem {
  path: string;
  label: string;
  description: string;
  /** Microservicio(s) que alimentan la sección: se muestran en pantalla. */
  servicio: string;
  roles: readonly string[];
}

export const MENU: MenuItem[] = [
  {
    path: '/zonas',
    label: 'Comparar zonas',
    description: 'Compara indicadores de ingreso, población y disponibilidad entre zonas.',
    servicio: 'catalog-service',
    roles: TODOS, // GET /v1/zones y /v1/zones/compare: los 6 internos (Matriz M02/M03 = L)
  },
  {
    path: '/asociacion',
    label: 'Reglas de asociación',
    description: 'Ejecuta Apriori o FP-Growth y consulta las corridas guardadas.',
    servicio: 'algorithms-core · catalog-service (zonas)',
    roles: TODOS, // consultar corridas: 6 internos (M10 = L); ejecutar: solo Analista (ACCIONES)
  },
  {
    path: '/elasticidad',
    label: 'Elasticidad',
    description: 'Consulta la elasticidad vigente y su comparación por zona; el Responsable de precios la calcula.',
    servicio: 'algorithms-core · catalog-service (presentaciones)',
    roles: TODOS, // GET chart/current: 6 internos (M11 = L); calcular: solo Responsable (ACCIONES)
  },
  {
    path: '/segmentos',
    label: 'Segmentos de ingreso',
    description: 'Consulta los segmentos y sus versiones; el Analista los crea y versiona.',
    servicio: 'income-segmentation-service',
    roles: TODOS, // GET: 6 internos (§3.2 = L); escribir: solo Analista (ACCIONES)
  },
  {
    path: '/simulacion',
    label: 'Simulación',
    description: 'Simula descuentos de precio y compara empaques; consulta los escenarios guardados.',
    servicio: 'decision-service · catalog-service (productos y zonas)',
    roles: TODOS, // GET scenarios: lectura de internos (M13 = L); simular: solo Planeador (ACCIONES)
  },
  {
    path: '/ventas',
    label: 'Importar ventas',
    description: 'Sube archivos de ventas, revisa la vista previa con errores por fila y confirma el lote.',
    servicio: 'transactions-ingestion-service',
    roles: SOLO_ANALISTA, // contrato 3111: los demás roles reciben 403 (el Administrador no entra al escritorio)
  },
  {
    path: '/reportes',
    label: 'Reportes ejecutivos',
    description: 'Consulta los reportes generados y descárgalos en PDF, Excel o CSV.',
    servicio: 'documents-service',
    roles: TODOS, // GET /v1/reports y /export: 6 internos; generar es del Gerente (no entra al escritorio)
  },
];

/** Secciones que ve un rol. [] si el rol no entra a la app. */
export function menuParaRol(rol: string | null | undefined): MenuItem[] {
  if (!rolAdmitido(rol)) return [];
  return MENU.filter((item) => item.roles.includes(rol as string));
}

/** ¿Este rol puede abrir esta ruta? Lo usa RoleRoute. */
export function puedeVerRuta(rol: string | null | undefined, path: string): boolean {
  return menuParaRol(rol).some((m) => m.path === path);
}
