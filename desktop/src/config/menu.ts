/**
 * Único lugar donde se define QUÉ secciones existen y QUÉ roles las ven.
 * El menú lateral, las rutas protegidas y las tarjetas de la pantalla de
 * inicio leen de esta lista, así que para dar o quitar acceso a un rol solo
 * se edita aquí.
 *
 * Los nombres de rol deben ser EXACTAMENTE los que devuelve auth-service
 * (vienen del seed db/data_retail.sql).
 */

/** Los 6 perfiles internos. El Proveedor es un usuario externo: no entra a esta app. */
export const ROLES_INTERNOS = [
  'Administrador',
  'Analista comercial',
  'Gerente de categoría',
  'Responsable de precios',
  'Planeador',
  'Auditor',
] as const;

const ADMIN_Y_ANALISTA = ['Administrador', 'Analista comercial'] as const;

export interface MenuItem {
  path: string;
  label: string;
  description: string;
  /** Microservicio que alimenta la sección (para que se vea en pantalla qué se consume). */
  servicio: string;
  roles: readonly string[];
}

export const MENU: MenuItem[] = [
  {
    path: '/zonas',
    label: 'Comparar zonas',
    description: 'Compara indicadores de ingreso, población y disponibilidad entre zonas.',
    servicio: 'catalog-service',
    roles: ROLES_INTERNOS, // GET /v1/zones: los 6 perfiles internos
  },
  {
    path: '/asociacion',
    label: 'Reglas de asociación',
    description: 'Ejecuta Apriori y consulta las corridas guardadas.',
    servicio: 'algorithms-core',
    roles: ROLES_INTERNOS, // consultar: los 6; ejecutar: solo Admin y Analista (se controla dentro de la pantalla)
  },
  {
    path: '/elasticidad',
    label: 'Elasticidad',
    description: 'Calcula y compara la elasticidad precio-demanda.',
    servicio: 'algorithms-core',
    roles: ROLES_INTERNOS,
  },
  {
    path: '/segmentos',
    label: 'Segmentos de ingreso',
    description: 'Consulta y configura los segmentos de ingreso.',
    servicio: 'catalog-service',
    roles: ROLES_INTERNOS, // editar: solo Admin y Analista (dentro de la pantalla)
  },
  {
    path: '/ventas',
    label: 'Importar ventas',
    description: 'Carga archivos de ventas para integrar transacciones.',
    servicio: 'core-process-service',
    roles: ADMIN_Y_ANALISTA, // supuesto: pendiente del contrato de core-process-service
  },
];

/** Secciones que ve un rol. Devuelve [] si el rol no entra a la app (ej. Proveedor). */
export function menuParaRol(rol: string | null): MenuItem[] {
  if (!rol) return [];
  return MENU.filter((item) => item.roles.includes(rol));
}

/** Para pantallas internas: ¿este rol puede ejecutar/modificar (no solo consultar)? */
export function puedeEscribir(rol: string | null): boolean {
  return rol !== null && (ADMIN_Y_ANALISTA as readonly string[]).includes(rol);
}