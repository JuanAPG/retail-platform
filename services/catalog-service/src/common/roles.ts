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

/** Quién resuelve las propuestas de alta de producto (RF-12). */
export const APRUEBAN_PRODUCTOS = [ROL.GERENTE_CATEGORIA] as const;

/**
 * Quién ve productos que aún no están activos (pendientes o rechazados).
 * El Gerente los resuelve; Administrador y Auditor solo los leen (CAT-05).
 * Para el resto del equipo un producto no activo no existe (D-08).
 */
export const VEN_NO_ACTIVOS = [ROL.GERENTE_CATEGORIA, ROL.ADMINISTRADOR, ROL.AUDITOR] as const;
