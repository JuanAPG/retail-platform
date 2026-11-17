import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Categoría de producto. Las llaves van en el orden del XSD (`category`): `activo` al final. */
@Entity({ name: 'categorias_producto' })
export class CategoriaProductoEntity {
  @PrimaryGeneratedColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'varchar', length: 80, unique: true })
  nombre: string;

  @Column({ name: 'categoria_padre_id', type: 'smallint', nullable: true })
  categoriaPadreId: number | null;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  /** T-21 / D-07: una categoría con productos no se borra, se desactiva. */
  @Column({ type: 'boolean', default: true })
  activo: boolean;
}
