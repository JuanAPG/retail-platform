import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { TiendaEntity } from './tienda.entity';
import { TransactionDetail } from './transaction-detail.entity';

/**
 * M06 — TransactionsModule (Juan Angel).
 *
 * Creada de forma temporal por M07 (Fernando) para poder construir
 * canastas; M06 la adopta como propia y la completa con las columnas
 * de trazabilidad que ya existen en `schema.sql` (`canal`,
 * `importacion_id`, `capturada_por`). No requiere migración: esas
 * columnas ya están en la tabla `transacciones`.
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
  fecha: Date;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  total: string;

  /** `canal_transaccion` en Postgres; varchar aquí (ver Importacion). */
  @Column({ type: 'varchar', length: 20, default: 'punto_venta' })
  canal: string;

  /** Trazabilidad de origen: de qué carga CSV salió, si vino de una. */
  @Column({ name: 'importacion_id', type: 'uuid', nullable: true })
  importacionId: string | null;

  @Column({ name: 'capturada_por', type: 'uuid', nullable: true })
  capturadaPor: string | null;

  @OneToMany(() => TransactionDetail, (d) => d.transaction)
  details: TransactionDetail[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}