import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Valores del ENUM `estatus_propuesta` del esquema. */
export const ESTATUS_PROPUESTA = {
  PENDIENTE: 'pendiente',
  APROBADO: 'aprobado',
  RECHAZADO: 'rechazado',
} as const;

/**
 * Propuesta de precio de un Proveedor para una presentación de su producto
 * (RN-14). Tabla de pricing-service (`precios_propuestos_proveedor`). La
 * propuesta es por presentación, sin tienda: quien aprueba elige a qué
 * tiendas se aplica. Presentaciones y proveedores son de otros servicios y se
 * leen por SQL.
 */
@Entity({ name: 'precios_propuestos_proveedor' })
export class PriceProposal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'presentacion_id', type: 'uuid' })
  presentationId: string;

  @Column({ name: 'proveedor_id', type: 'uuid' })
  supplierId: string;

  @Column({ name: 'precio_propuesto', type: 'numeric', precision: 12, scale: 2 })
  proposedPrice: string;

  @Column({ name: 'unidad_compra', type: 'varchar', length: 30, nullable: true })
  purchaseUnit: string | null;

  /** `pendiente` | `aprobado` | `rechazado` (ENUM `estatus_propuesta`). */
  @Column({ name: 'estatus', type: 'varchar', length: 20, default: ESTATUS_PROPUESTA.PENDIENTE })
  status: string;

  @Column({ name: 'motivo_rechazo', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'revisado_por', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'revisado_en', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
