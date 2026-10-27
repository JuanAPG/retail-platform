import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Mapea 1:1 a la tabla `roles` de schema.sql.
 * Los 8 roles del sistema (Administrador, Analista comercial,
 * Gerente de categoría, Responsable de precios, Planeador,
 * Auditor, Proveedor e Investigador de mercado, este último
 * agregado por D-28) ya deben existir como filas insertadas
 * manualmente por el equipo (este microservicio NO los crea).
 */
@Entity({ name: 'roles' })
export class RoleEntity {
  @PrimaryGeneratedColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'varchar', length: 40, unique: true })
  nombre: string;

  @Column({ type: 'text' })
  descripcion: string;
}
