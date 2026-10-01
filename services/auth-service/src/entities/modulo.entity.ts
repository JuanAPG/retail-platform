import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Mapea 1:1 a la tabla `modulos` de schema.sql.
 * La clave (`M01`, `M06`…) es el vocabulario común entre la matriz de
 * permisos, los contratos y las ramas del equipo.
 */
@Entity({ name: 'modulos' })
export class ModuloEntity {
  @PrimaryGeneratedColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'varchar', length: 10, unique: true })
  clave: string;

  @Column({ type: 'varchar', length: 60, unique: true })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;
}
