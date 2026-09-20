import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { TiendaEntity } from './tienda.entity';
import { TransactionDetail } from './transaction-detail.entity';

/**
 * M06 — TransactionsModule (Juan Angel), según Contrato de Métodos y
 * Endpoints. Este archivo se crea aquí de forma TEMPORAL porque M06
 * todavía no existe (baskets.module.ts estaba vacío, igual que
 * transactions.module.ts). Cuando Juan construya su módulo, debe
 * REUTILIZAR este mismo archivo en vez de crear uno propio —
 * avísale para que no terminemos con dos entidades para la misma tabla.
 */
@Entity({ name: 'transacciones' })
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  folio: string;

  @Column({ name: 'tienda_id', type: 'uuid' })
  storeId: string;

  @ManyToOne(() => TiendaEntity, { eager: true })
  @JoinColumn({ name: 'tienda_id' })
  store: TiendaEntity;

  @Column({ type: 'timestamptz' })
  date: Date;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  total: string;

  @OneToMany(() => TransactionDetail, (d) => d.transaction)
  details: TransactionDetail[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}