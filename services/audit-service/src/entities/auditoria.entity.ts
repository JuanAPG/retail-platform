import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { AuditoriaCambio } from './auditoria-cambio.entity';

/** Acciones del ENUM `accion_auditoria` de schema.sql (§15, RN-13). */
export type AccionAuditoria =
  | 'insert'
  | 'update'
  | 'delete'
  | 'login'
  | 'importacion'
  | 'aprobar'
  | 'rechazar'
  | 'desactivar'
  | 'ejecutar_corrida'
  | 'simular'
  | 'generar_recomendacion'
  | 'exportar';

/**
 * M15 — Evento de bitácora (`auditoria`). Append-only: nunca se actualiza
 * ni se borra desde la API. `usuarioId`/`rolId` SIEMPRE salen del token
 * de quien llama a `POST /v1/auditoria` (SessionGuard), nunca del cuerpo:
 * `rolId` es el rol VIGENTE EN EL INSTANTE del evento, no un join vivo a
 * `usuarios.rol_id` (el rol puede cambiar después y la bitácora no debe
 * cambiar con él).
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

  /** Microservicio que reportó el evento (p. ej. `pricing-service`). */
  @Column({ type: 'varchar', length: 40 })
  servicio: string;

  @Column({
    type: 'enum',
    enum: [
      'insert',
      'update',
      'delete',
      'login',
      'importacion',
      'aprobar',
      'rechazar',
      'desactivar',
      'ejecutar_corrida',
      'simular',
      'generar_recomendacion',
      'exportar',
    ],
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
