import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

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
}
