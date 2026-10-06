import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UsuarioEntity } from './usuario.entity';
import { TiendaEntity } from './tienda.entity';

/**
 * M06 — TransactionsModule (Juan Angel).
 *
 * Cabecera de una carga CSV: archivo, quién, cuándo, estado y resumen.
 * Estados (`estado_importacion` en schema.sql): cargado → validado |
 * con_errores → confirmado | descartado. El hash SHA-256 evita que el
 * mismo archivo se procese dos veces (uq_importacion_hash_no_descartada).
 *
 * `estado` se mapea como varchar (precedente: `productos.estatus`):
 * con `synchronize: false` no se registra el enum en TypeORM, pero la
 * columna real en Postgres sí es el enum y acepta estos mismos valores.
 */
export type EstadoImportacion =
  | 'cargado'
  | 'validado'
  | 'con_errores'
  | 'confirmado'
  | 'descartado';

@Entity({ name: 'importaciones' })
export class Importacion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'nombre_archivo', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'hash_archivo', type: 'char', length: 64 })
  fileHash: string;

  @Column({ name: 'tamano_bytes', type: 'bigint' })
  fileSizeBytes: string;

  /** NULL = la tienda viene en cada fila del CSV. */
  @Column({ name: 'tienda_id', type: 'uuid', nullable: true })
  storeId: string | null;

  @ManyToOne(() => TiendaEntity, { nullable: true })
  @JoinColumn({ name: 'tienda_id' })
  store: TiendaEntity | null;

  @Column({ type: 'varchar', length: 20, default: 'cargado' })
  estado: EstadoImportacion;

  @Column({ name: 'cargado_por', type: 'uuid' })
  uploadedBy: string;

  @ManyToOne(() => UsuarioEntity, { eager: false })
  @JoinColumn({ name: 'cargado_por' })
  uploadedByUser: UsuarioEntity;

  @CreateDateColumn({ name: 'cargado_en', type: 'timestamptz' })
  uploadedAt: Date;

  @Column({ name: 'confirmado_por', type: 'uuid', nullable: true })
  confirmedBy: string | null;

  @Column({ name: 'confirmado_en', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'filas_totales', type: 'int', default: 0 })
  totalRows: number;

  @Column({ name: 'filas_validas', type: 'int', default: 0 })
  validRows: number;

  @Column({ name: 'filas_con_error', type: 'int', default: 0 })
  errorRows: number;

  @Column({ name: 'transacciones_creadas', type: 'int', default: 0 })
  createdTransactions: number;
}
