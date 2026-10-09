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
 * Decisión D1 del equipo: ÚNICAMENTE el Responsable de precios. El Gerente de
 * categoría y el Administrador no resuelven precios.
 */
export const APRUEBAN_PRECIOS = [ROL.RESPONSABLE_PRECIOS] as const;

/** Quién consulta las propuestas de precio (el Proveedor, solo las suyas). */
export const VEN_PROPUESTAS_PRECIO = [
  ROL.PROVEEDOR,
  ROL.ADMINISTRADOR,
  ROL.GERENTE_CATEGORIA,
  ROL.RESPONSABLE_PRECIOS,
  ROL.AUDITOR,
] as const;

/** PRI-07 (D-09): quién configura el umbral de la alerta de cambio de precio, y quién lo consulta. */
export const CONFIGURAN_ALERTAS = [ROL.RESPONSABLE_PRECIOS] as const;
export const VEN_ALERTAS = [ROL.RESPONSABLE_PRECIOS, ROL.ADMINISTRADOR, ROL.AUDITOR] as const;

/**
 * PRI-09 (D-16): quién captura un precio observado en tienda desde la app móvil.
 * POR CONFIRMAR con el equipo: la Matriz no tiene un perfil "Investigador de mercado". Mientras tanto
 * capturan el Analista comercial (trabajo de campo y análisis) y el Responsable de precios.
 * Cambiarlo es tocar solo esta constante.
 */
export const CAPTURAN_OBSERVACIONES = [ROL.ANALISTA, ROL.RESPONSABLE_PRECIOS] as const;

/** Ven las observaciones pendientes y su historial. El Analista solo ve las que capturó. */
export const VEN_OBSERVACIONES = [ROL.RESPONSABLE_PRECIOS, ROL.ADMINISTRADOR, ROL.AUDITOR, ROL.ANALISTA] as const;
