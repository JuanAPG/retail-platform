import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CategoriaProductoEntity } from './categoria-producto.entity';
import { ProveedorEntity } from './proveedor.entity';

@Entity({ name: 'productos' })
export class ProductoEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40, unique: true })
  sku: string;

  @Column({ type: 'varchar', length: 150 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ name: 'categoria_id', type: 'smallint' })
  categoriaId: number;

  @ManyToOne(() => CategoriaProductoEntity, { eager: true })
  @JoinColumn({ name: 'categoria_id' })
  categoria: CategoriaProductoEntity;

  @Column({ name: 'unidad_medida', type: 'varchar', length: 20 })
  unidadMedida: string;

  @Column({ name: 'imagen_url', type: 'text', nullable: true })
  imagenUrl: string | null;

  @Column({ name: 'es_canasta_basica', type: 'boolean', default: false })
  esCanastaBasica: boolean;

  @Column({ type: 'varchar', length: 30 })
  estatus: string;

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @ManyToOne(() => ProveedorEntity, { eager: true, nullable: true })
  @JoinColumn({ name: 'proveedor_id' })
  proveedor: ProveedorEntity | null;

  /**
   * Usuario (Gerente de categoría o Administrador) que resolvió la
   * propuesta. Se guarda como UUID suelto y no como relación: el
   * usuario que aprueba vive en el módulo de usuarios y este módulo
   * solo necesita el identificador para dejar rastro de quién decidió.
   */
  @Column({ name: 'aprobado_por', type: 'uuid', nullable: true })
  aprobadoPor: string | null;

  @Column({ name: 'motivo_rechazo', type: 'text', nullable: true })
  motivoRechazo: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
