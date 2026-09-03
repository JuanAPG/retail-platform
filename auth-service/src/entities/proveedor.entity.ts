import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Mapea 1:1 a la tabla `proveedores` de schema.sql.
 *
 * Nota de diseño importante: tras el cambio de schema, `usuarios`
 * ya NO tiene una llave foránea directa a `proveedores` (ese vínculo
 * se movió a `tiendas.proveedor_id`). Por lo tanto, la relación entre
 * la cuenta de acceso (usuarios, rol = 'Proveedor') y la empresa
 * (proveedores) se resuelve por `email` compartido entre ambas tablas.
 * El flujo de registro de este microservicio crea ambos registros en
 * una sola transacción usando el mismo correo para garantizar esa
 * correspondencia. Ver AuthService.registerProveedor().
 */
@Entity({ name: 'proveedores' })
export class ProveedorEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'razon_social', type: 'varchar', length: 150 })
  razonSocial: string;

  @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
  rfc: string;

  @Column({ name: 'contacto_nombre', type: 'varchar', length: 120, nullable: true })
  contactoNombre: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  telefono: string;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
