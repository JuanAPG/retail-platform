/**
 * Nombres de rol EXACTOS como están sembrados en la tabla `roles`
 * (`db/data_retail.sql`) y como los escribe la Matriz §3.
 *
 * Vive en common/ porque lo necesitan todos los módulos de negocio: si cada
 * uno escribiera los literales a mano, un acento o una mayúscula distinta
 * abriría un hueco de permisos que compila sin quejarse. Por eso siempre se
 * usa `ROL.X`, nunca un string suelto.
 *
 * Esta es la copia de la plantilla: un servicio nuevo arranca con este
 * archivo. Si aquí cambia algo, cambia en los demás servicios, en
 * `services/analytics-stats/app/roles.py` y en `db/data_retail.sql`; además
 * se actualiza `docs/matriz-perfiles-permisos.md` y se avisa al equipo.
 */
export const ROL = {
  ADMINISTRADOR: 'Administrador',
  ANALISTA: 'Analista comercial',
  GERENTE_CATEGORIA: 'Gerente de categoría',
  RESPONSABLE_PRECIOS: 'Responsable de precios',
  PLANEADOR: 'Planeador',
  AUDITOR: 'Auditor',
  PROVEEDOR: 'Proveedor',
  /** D-28: usuario de la app móvil. NO va en PERFILES_INTERNOS: esa lista
   *  abre lecturas (recomendaciones, escenarios, bitácora) que D-28 no le da.
   *  Se nombra explícitamente en cada ruta que sí lo acepta. */
  INVESTIGADOR: 'Investigador de mercado',
} as const;

/**
 * Los seis perfiles internos "de oficina". El Proveedor (externo) y el
 * Investigador de mercado (campo, D-28) quedan fuera a propósito: cada uno
 * se nombra ruta por ruta.
 */
export const PERFILES_INTERNOS = [
  ROL.ADMINISTRADOR,
  ROL.ANALISTA,
  ROL.GERENTE_CATEGORIA,
  ROL.RESPONSABLE_PRECIOS,
  ROL.PLANEADOR,
  ROL.AUDITOR,
] as const;

/** Forma de `request.user` que deja el guard de sesión. */
export interface UsuarioSolicitante {
  id: string;
  email: string;
  nombre: string;
  rol: string;
  rolId: number;
  activo: boolean;
}
