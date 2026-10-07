/**
 * Nombres de rol EXACTOS como están sembrados en la tabla `roles`.
 *
 * Vive en common/ porque lo necesitan todos los módulos de negocio: si
 * cada uno escribiera los literales a mano, un acento o una mayúscula
 * distinta abriría un hueco de permisos que compila sin quejarse.
 * Cualquier cambio aquí debe reflejarse también en
 * docs/matriz-perfiles-permisos.docx (avisar al equipo).
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

/**
 * Perfiles sin ninguna ruta de escritura en este servicio.
 *
 * El Analista NO está aquí: el contrato de Fase A
 * (`docs/contratos/core-process-transactions.md`) le da escritura sobre
 * transacciones e importación CSV, y así está implementado. El comentario
 * anterior lo listaba como solo-consulta y contradecía al contrato — hay
 * que confirmarlo contra `docs/matriz-perfiles-permisos.docx`, que es la
 * autoridad, y avisar al equipo si la matriz dice otra cosa.
 */
export const PERFILES_DE_CONSULTA = [ROL.AUDITOR, ROL.PLANEADOR] as const;

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
