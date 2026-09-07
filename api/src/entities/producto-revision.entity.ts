import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Cada decisión sobre una propuesta de alta es un evento con su propio
 * autor, fecha y motivo. Antes vivía como columnas nulables en
 * `productos` (`aprobado_por`, `motivo_rechazo`) y cada revisión
 * sobrescribía la anterior, perdiendo el historial.
 */
@Entity({ name: 'producto_revisiones' })
export class ProductoRevisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'estatus_resultante', type: 'varchar', length: 30 })
  estatusResultante: string;

  @Column({ name: 'revisado_por', type: 'uuid' })
  revisadoPor: string;

  @Column({ type: 'text', nullable: true })
  motivo: string | null;

  @Column({ name: 'revisado_en', type: 'timestamptz' })
  revisadoEn: Date;
}
