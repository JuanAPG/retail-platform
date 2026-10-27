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
  /** D-28: usuario de la app móvil. NO va en PERFILES_INTERNOS: esa lista
   *  abre lecturas (recomendaciones, escenarios, bitácora) que D-28 no le da.
   *  Se nombra explícitamente en cada ruta que sí lo acepta. */
  INVESTIGADOR: 'Investigador de mercado',
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
 * Ya no está por confirmar: D-28 creó el perfil `Investigador de mercado` y le dio
 * el alta de precios observados (Matriz §3, M08: P). Se queda además el Analista
 * comercial y el Responsable de precios, que ya capturaban antes de que el rol
 * existiera. Cambiarlo es tocar solo esta constante.
 */
export const CAPTURAN_OBSERVACIONES = [
  ROL.ANALISTA,
  ROL.RESPONSABLE_PRECIOS,
  // D-28: el Investigador de mercado levanta el precio desde la app móvil.
  // Solo da de alta: la observación nace pendiente y la aprueba el
  // Responsable de precios (D-16). No lee la bandeja ni aprueba nada.
  ROL.INVESTIGADOR,
] as const;

/** Ven las observaciones pendientes y su historial. El Analista solo ve las que capturó. */
export const VEN_OBSERVACIONES = [ROL.RESPONSABLE_PRECIOS, ROL.ADMINISTRADOR, ROL.AUDITOR, ROL.ANALISTA] as const;
