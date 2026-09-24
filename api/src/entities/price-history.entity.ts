import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProductoPresentacionEntity } from './producto-presentacion.entity';
import { TiendaEntity } from './tienda.entity';

/**
 * M08 — Histórico de precios (RN-06). Versionado por presentación y
 * tienda: cerrar un precio es ponerle `effectiveUntil`, nunca se
 * sobrescribe, porque es lo que hace posible calcular elasticidad en
 * M11. La zona no se guarda aquí: se deriva de `store.zona` (el precio
 * es por tienda, no por zona).
 */
@Entity({ name: 'precios' })
export class PriceHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'presentacion_id', type: 'uuid' })
  presentationId: string;

  @ManyToOne(() => ProductoPresentacionEntity, { eager: true })
  @JoinColumn({ name: 'presentacion_id' })
  presentation: ProductoPresentacionEntity;

  @Column({ name: 'tienda_id', type: 'uuid' })
  storeId: string;

  @ManyToOne(() => TiendaEntity, { eager: true })
  @JoinColumn({ name: 'tienda_id' })
  store: TiendaEntity;

  @Column({ name: 'precio', type: 'numeric', precision: 12, scale: 2 })
  price: string;

  @Column({ name: 'fecha_vigencia_desde', type: 'date' })
  effectiveDate: string;

  @Column({ name: 'fecha_vigencia_hasta', type: 'date', nullable: true })
  effectiveUntil: string | null;

  /** Columna GENERATED en el esquema (fecha_vigencia_hasta IS NULL): nunca se escribe desde la app. */
  @Column({ type: 'boolean', insert: false, update: false })
  vigente: boolean;

  @Column({ type: 'varchar', length: 30, default: 'interno' })
  origen: string;

  @Column({ name: 'creado_por', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
