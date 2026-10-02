import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UnidadMedidaEntity } from './unidad-medida.entity';
import { ProductoEntity } from './producto.entity';

/**
 * RF-35. Un producto tiene varias presentaciones (500 g, 1 kg, six-pack).
 * Precios, inventario y líneas de venta apuntan AQUÍ, no al producto:
 * 500 g y 1 kg del mismo producto valen distinto.
 */
@Entity({ name: 'producto_presentaciones' })
export class ProductoPresentacionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @ManyToOne(() => ProductoEntity, (p) => p.presentaciones, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'producto_id' })
  producto: ProductoEntity;

  @Column({ type: 'varchar', length: 60 })
  nombre: string;

  @Column({ type: 'numeric', precision: 12, scale: 3 })
  contenido: string;

  @Column({ name: 'unidad_medida_id', type: 'smallint' })
  unidadMedidaId: number;

  @ManyToOne(() => UnidadMedidaEntity, { eager: true })
  @JoinColumn({ name: 'unidad_medida_id' })
  unidadMedida: UnidadMedidaEntity;

  @Column({ name: 'codigo_barras', type: 'varchar', length: 20, nullable: true })
  codigoBarras: string | null;

  @Column({ name: 'es_predeterminada', type: 'boolean', default: false })
  esPredeterminada: boolean;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
