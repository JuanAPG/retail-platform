import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RoleEntity } from './role.entity';

/**
 * Mapea 1:1 a la tabla `usuarios` de schema.sql (ya sin `proveedor_id`,
 * que se movió a `tiendas`). El password_hash nunca debe salir en
 * respuestas HTTP; se excluye explícitamente en AuthService/UsersService.
 */
@Entity({ name: 'usuarios' })
export class UsuarioEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash: string;

  @Column({ name: 'rol_id', type: 'smallint' })
  rolId: number;

  @ManyToOne(() => RoleEntity, { eager: true })
  @JoinColumn({ name: 'rol_id' })
  rol: RoleEntity;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
