/**
 * Nombres de rol EXACTOS como están sembrados en la tabla `roles`.
 *
 * Vive en common/ porque lo necesitan todos los módulos de negocio: si
 * cada uno escribiera los literales a mano, un acento o una mayúscula
 * distinta abriría un hueco de permisos que compila sin quejarse.
 * Cualquier cambio aquí debe reflejarse también en
 * docs/matriz-perfiles-permisos.md (la fuente; el .docx es una copia para
 * entregar) y avisarse al equipo.
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

/**
 * Perfiles sin ninguna ruta de escritura en este servicio.
 *
 * Confirmado contra la Matriz §3 (`docs/matriz-perfiles-permisos.md`), que es
 * la autoridad: en M06 (Transacciones) y M07 (Canastas) el **Analista
 * comercial** es Total y los otros cinco perfiles internos son Lectura. Por
 * eso el **Administrador** está aquí: tenía escritura en las 6 rutas
 * (registro manual, las tres de importación CSV y las dos de reclasificar) y
 * la Matriz solo le da Lectura, así que se le quitó.
 *
 * El Gerente de categoría y el Responsable de precios no se listan porque
 * nunca tuvieron escritura aquí; se agregan si algún día hace falta la lista
 * completa.
 */
export const PERFILES_DE_CONSULTA = [ROL.ADMINISTRADOR, ROL.AUDITOR, ROL.PLANEADOR] as const;

/** Quién resuelve las propuestas de alta de producto (RF-12). */
export const APRUEBAN_PRODUCTOS = [ROL.ADMINISTRADOR, ROL.GERENTE_CATEGORIA] as const;

/** Forma de `request.user` que produce JwtStrategy.validate(). */
export interface UsuarioSolicitante {
  id: string;
  email: string;
  nombre: string;
  rol: string;
  rolId: number;
  activo: boolean;
}
