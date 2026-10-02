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
export const APRUEBAN_PRODUCTOS = [ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA] as const;

/**
 * Quién aprueba o rechaza las propuestas de precio del Proveedor (RN-14).
 * POR CONFIRMAR con el equipo (¿Gerente de categoría o Responsable de precios?):
 * hoy coincide con la pestaña "Aprobaciones de precio" del portal de categoría.
 * Cambiarlo es tocar solo esta constante.
 */
export const APRUEBAN_PRECIOS = [ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA] as const;

/** Quién consulta las propuestas de precio (el Proveedor, solo las suyas). */
export const VEN_PROPUESTAS_PRECIO = [
  ROL.PROVEEDOR,
  ROL.ADMINISTRADOR,
  ROL.GERENTE_CATEGORIA,
  ROL.RESPONSABLE_PRECIOS,
  ROL.AUDITOR,
] as const;
