import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CategoriaProductoEntity } from './categoria-producto.entity';
import { ProveedorEntity } from './proveedor.entity';
import { ProductoPresentacionEntity } from './producto-presentacion.entity';

/**
 * Catálogo de productos. Ya NO guarda unidad de medida (vive en
 * `producto_presentaciones`, RF-35) ni los datos de la revisión
 * (`aprobado_por`, `motivo_rechazo`, ahora en `producto_revisiones`).
 * `estatus` se queda porque es el estado actual del producto y depende
 * solo de su llave.
 */
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

  @Column({ name: 'es_canasta_basica', type: 'boolean', default: false })
  esCanastaBasica: boolean;

  @Column({ type: 'varchar', length: 30 })
  estatus: string;

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @ManyToOne(() => ProveedorEntity, { eager: true, nullable: true })
  @JoinColumn({ name: 'proveedor_id' })
  proveedor: ProveedorEntity | null;

  /** RF-35: 500 g, 1 kg, six-pack… El precio y la venta van por aquí. */
  @OneToMany(() => ProductoPresentacionEntity, (p) => p.producto)
  presentaciones: ProductoPresentacionEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
