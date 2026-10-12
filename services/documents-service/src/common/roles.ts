/**
 * Nombres de rol EXACTOS como están sembrados en la tabla `roles`.
 * Copia de `auth-service/src/common/roles.ts`: si ahí cambia, aquí también.
 * Cualquier cambio debe reflejarse en docs/matriz-perfiles-permisos.docx
 * (avisar al equipo).
 */
export const ROL = {
  ADMINISTRADOR: 'Administrador',
  ANALISTA: 'Analista comercial',
  GERENTE_CATEGORIA: 'Gerente de categoría',
  RESPONSABLE_PRECIOS: 'Responsable de precios',
  PLANEADOR: 'Planeador',
  AUDITOR: 'Auditor',
  PROVEEDOR: 'Proveedor',
} as const;

/** Los seis perfiles internos. El Proveedor es externo y va aparte. */
export const PERFILES_INTERNOS = [
  ROL.ADMINISTRADOR,
  ROL.ANALISTA,
  ROL.GERENTE_CATEGORIA,
  ROL.RESPONSABLE_PRECIOS,
  ROL.PLANEADOR,
  ROL.AUDITOR,
] as const;

/** DOC-01 (D-20): el Gerente de categoría genera el reporte ejecutivo. */
export const GENERAN_REPORTES = [ROL.GERENTE_CATEGORIA] as const;

/** Leen reportes: los 6 internos y el Proveedor (este último solo los propios, DOC-04). */
export const LEEN_REPORTES = [...PERFILES_INTERNOS, ROL.PROVEEDOR] as const;
