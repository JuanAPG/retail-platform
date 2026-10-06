import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Importacion } from './importacion.entity';
import { TiendaEntity } from './tienda.entity';
import { ProductoPresentacionEntity } from './producto-presentacion.entity';
import { Transaction } from './transaction.entity';

/**
 * M06 — Staging tipado de una fila del CSV.
 *
 * Guarda TANTO el texto original (`*_origen`) COMO lo que resolvió la
 * validación (`tienda_id`, `presentacion_id`, `fecha`, `cantidad`,
 * `precio_unitario`). Nada pasa a `transacciones` hasta que la
 * importación se confirma; al confirmar, `transaccion_id` liga la fila
 * con la transacción que produjo.
 */
@Entity({ name: 'importacion_filas' })
export class ImportacionFila {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'importacion_id', type: 'uuid' })
  importacionId: string;

  @ManyToOne(() => Importacion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'importacion_id' })
  importacion: Importacion;

  @Column({ name: 'numero_fila', type: 'int' })
  rowNumber: number;

  // --- Texto tal como venía en el archivo, sin convertir ---
  @Column({ name: 'folio_origen', type: 'varchar', length: 60, nullable: true })
  folioOrigen: string | null;

  @Column({ name: 'fecha_origen', type: 'varchar', length: 40, nullable: true })
  fechaOrigen: string | null;

  @Column({ name: 'tienda_origen', type: 'varchar', length: 150, nullable: true })
  tiendaOrigen: string | null;

  @Column({ name: 'sku_origen', type: 'varchar', length: 60, nullable: true })
  skuOrigen: string | null;

  @Column({ name: 'presentacion_origen', type: 'varchar', length: 60, nullable: true })
  presentacionOrigen: string | null;

  @Column({ name: 'cantidad_origen', type: 'varchar', length: 40, nullable: true })
  cantidadOrigen: string | null;

  @Column({ name: 'precio_origen', type: 'varchar', length: 40, nullable: true })
  precioOrigen: string | null;

  // --- Resultado de la validación: qué entidad resolvió cada texto ---
  @Column({ name: 'tienda_id', type: 'uuid', nullable: true })
  storeId: string | null;

  @ManyToOne(() => TiendaEntity, { nullable: true })
  @JoinColumn({ name: 'tienda_id' })
  store: TiendaEntity | null;

  @Column({ name: 'presentacion_id', type: 'uuid', nullable: true })
  presentationId: string | null;

  @ManyToOne(() => ProductoPresentacionEntity, { nullable: true })
  @JoinColumn({ name: 'presentacion_id' })
  presentation: ProductoPresentacionEntity | null;

  @Column({ type: 'timestamptz', nullable: true })
  fecha: Date | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  cantidad: string | null;

  @Column({ name: 'precio_unitario', type: 'numeric', precision: 12, scale: 2, nullable: true })
  unitPrice: string | null;

  @Column({ type: 'boolean', default: false })
  valida: boolean;

  /** Se llena al confirmar: liga la fila con la transacción que produjo. */
  @Column({ name: 'transaccion_id', type: 'uuid', nullable: true })
  transactionId: string | null;

  @ManyToOne(() => Transaction, { nullable: true })
  @JoinColumn({ name: 'transaccion_id' })
  transaction: Transaction | null;
}
