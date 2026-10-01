import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Niveles del ENUM `nivel_permiso` de schema.sql. */
export type NivelPermiso =
  | 'total'
  | 'lectura_actualiza'
  | 'lectura'
  | 'propone'
  | 'aprueba'
  | 'lectura_propios'
  | 'sin_acceso';

/**
 * Mapea 1:1 a la tabla `rol_modulo_permiso` (matriz RBAC dirigida por
 * datos). Llave compuesta: un rol tiene un solo nivel por módulo.
 */
@Entity({ name: 'rol_modulo_permiso' })
export class RolModuloPermisoEntity {
  @PrimaryColumn({ name: 'rol_id', type: 'smallint' })
  rolId: number;

  @PrimaryColumn({ name: 'modulo_id', type: 'smallint' })
  moduloId: number;

  @Column({
    type: 'enum',
    enum: ['total', 'lectura_actualiza', 'lectura', 'propone', 'aprueba', 'lectura_propios', 'sin_acceso'],
    enumName: 'nivel_permiso',
    default: 'sin_acceso',
  })
  nivel: NivelPermiso;
}
