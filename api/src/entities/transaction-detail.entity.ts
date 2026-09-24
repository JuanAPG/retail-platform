import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Transaction } from './transaction.entity';
import { ProductoPresentacionEntity } from './producto-presentacion.entity';

/** M06 (Juan) — ver nota de temporalidad en transaction.entity.ts */
@Entity({ name: 'transacciones_detalle' })
export class TransactionDetail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'transaccion_id', type: 'uuid' })
  transactionId: string;

  @ManyToOne(() => Transaction, (t) => t.details, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transaccion_id' })
  transaction: Transaction;

  @Column({ name: 'presentacion_id', type: 'uuid' })
  presentationId: string;

  @ManyToOne(() => ProductoPresentacionEntity, { eager: true })
  @JoinColumn({ name: 'presentacion_id' })
  presentation: ProductoPresentacionEntity;

  @Column({ name: 'cantidad', type: 'numeric', precision: 10, scale: 2 })
  quantity: string;

  @Column({ name: 'precio_unitario', type: 'numeric', precision: 12, scale: 2 })
  unitPrice: string;

  // Columna GENERATED en Postgres (cantidad * precio_unitario): solo se lee.
  @Column({ type: 'numeric', precision: 14, scale: 2, insert: false, update: false })
  subtotal: string;
}