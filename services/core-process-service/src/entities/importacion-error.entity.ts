import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Importacion } from './importacion.entity';

/**
 * M06 — Errores de validación del CSV, con fila y columna exactas para
 * que el usuario corrija el archivo. `numero_fila` NULL = error del
 * archivo completo (encabezado, formato, duplicado).
 */
@Entity({ name: 'importacion_errores' })
export class ImportacionError {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'importacion_id', type: 'uuid' })
  importacionId: string;

  @ManyToOne(() => Importacion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'importacion_id' })
  importacion: Importacion;

  @Column({ name: 'numero_fila', type: 'int', nullable: true })
  rowNumber: number | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  columna: string | null;

  /** Código estable para el frontend: 'SKU_NO_EXISTE', 'FECHA_INVALIDA'… */
  @Column({ type: 'varchar', length: 40 })
  codigo: string;

  @Column({ type: 'text' })
  mensaje: string;

  /** `severidad_error` en Postgres; se mapea como varchar (ver Importacion). */
  @Column({ type: 'varchar', length: 12, default: 'error' })
  severidad: string;

  @Column({ name: 'valor_recibido', type: 'text', nullable: true })
  valorRecibido: string | null;
}
