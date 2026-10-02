import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { AuditoriaCambio } from './auditoria-cambio.entity';

/** Acciones del ENUM `accion_auditoria` de schema.sql (§15, RN-13). */
export type AccionAuditoria = 'insert' | 'update' | 'delete' | 'login' | 'importacion';

/**
 * M15 — Evento de bitácora (`auditoria`). Append-only: nunca se actualiza
 * ni se borra desde la API. `rolId` es el rol VIGENTE EN EL INSTANTE del
 * evento, no un join vivo a `usuarios.rol_id` (el rol puede cambiar
 * después y la bitácora no debe cambiar con él).
 */
@Entity({ name: 'auditoria' })
export class Auditoria {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'rol_id', type: 'smallint', nullable: true })
  rolId: number | null;

  @Column({ name: 'tabla_afectada', type: 'varchar', length: 80 })
  tablaAfectada: string;

  @Column({ name: 'registro_id', type: 'text', nullable: true })
  registroId: string | null;

  @Column({
    type: 'enum',
    enum: ['insert', 'update', 'delete', 'login', 'importacion'],
    enumName: 'accion_auditoria',
  })
  accion: AccionAuditoria;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ name: 'direccion_ip', type: 'inet', nullable: true })
  direccionIp: string | null;

  @CreateDateColumn({ name: 'fecha', type: 'timestamptz' })
  fecha: Date;

  @OneToMany(() => AuditoriaCambio, (cambio) => cambio.auditoria)
  cambios: AuditoriaCambio[];
}
