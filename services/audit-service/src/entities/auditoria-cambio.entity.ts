import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Auditoria } from './auditoria.entity';

/**
 * M15 — Campos modificados por un evento (`auditoria_cambios`). Separar el
 * evento de sus campos permite preguntar "¿quién cambió el precio de este
 * producto?" sin recorrer JSON.
 */
@Entity({ name: 'auditoria_cambios' })
export class AuditoriaCambio {
  @PrimaryColumn({ name: 'auditoria_id', type: 'bigint' })
  auditoriaId: string;

  @PrimaryColumn({ type: 'varchar', length: 80 })
  campo: string;

  @Column({ name: 'valor_previo', type: 'text', nullable: true })
  valorPrevio: string | null;

  @Column({ name: 'valor_posterior', type: 'text', nullable: true })
  valorPosterior: string | null;

  @ManyToOne(() => Auditoria, (auditoria) => auditoria.cambios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'auditoria_id' })
  auditoria: Auditoria;
}
