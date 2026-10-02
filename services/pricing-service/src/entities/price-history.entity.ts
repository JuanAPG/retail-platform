import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Histórico de precios (RN-06). Versionado por presentación y tienda:
 * cerrar un precio es ponerle `effectiveUntil`, nunca se sobrescribe,
 * porque es lo que hace posible calcular elasticidad. La zona no se guarda
 * aquí: se deriva de la tienda (`tiendas.zona_id`).
 *
 * Esta es la ÚNICA tabla que escribe pricing-service. Presentaciones,
 * tiendas y zonas son de catalog-service y se leen por SQL, sin mapearlas
 * como entidades (así no se duplica su modelo ni sus relaciones).
 */
@Entity({ name: 'precios' })
export class PriceHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'presentacion_id', type: 'uuid' })
  presentationId: string;

  @Column({ name: 'tienda_id', type: 'uuid' })
  storeId: string;

  @Column({ name: 'precio', type: 'numeric', precision: 12, scale: 2 })
  price: string;

  @Column({ name: 'fecha_vigencia_desde', type: 'date' })
  effectiveDate: string;

  @Column({ name: 'fecha_vigencia_hasta', type: 'date', nullable: true })
  effectiveUntil: string | null;

  /** Columna GENERATED en el esquema (fecha_vigencia_hasta IS NULL): nunca se escribe desde la app. */
  @Column({ type: 'boolean', insert: false, update: false })
  vigente: boolean;

  /** `interno` | `propuesta_proveedor_aprobada` (ENUM `origen_precio`). */
  @Column({ type: 'varchar', length: 30, default: 'interno' })
  origen: string;

  @Column({ name: 'creado_por', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
