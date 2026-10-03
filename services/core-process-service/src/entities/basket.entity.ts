import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Transaction } from './transaction.entity';
import { ZonaEntity } from './zona.entity';

/**
 * M07 — BasketsModule (Fernando), según Contrato de Métodos y Endpoints.
 *
 * Nombres de propiedad en inglés, tal como pide el contrato. Los nombres
 * de columna se quedan en español porque son la tabla `canastas` real
 * de schema.sql — no se está migrando el esquema, solo la capa de código.
 *
 * `segmentId` queda NULLABLE y se guarda en null hasta que exista un
 * método de resolución en ZonesModule o SegmentsModule (ninguno lo tiene
 * hoy — ver TODO en BasketsService).
 *
 * `storeId` y `hasBasicProducts` NO son columnas de la tabla: no están en
 * schema.sql. Se calculan al vuelo (ver BasketsService) para cumplir el
 * contrato sin requerir una migración de base de datos.
 */
@Entity({ name: 'canastas' })
export class Basket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'transaccion_id', type: 'uuid', unique: true })
  transactionId: string;

  @ManyToOne(() => Transaction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transaccion_id' })
  transaction: Transaction;

  @Column({ name: 'zona_id', type: 'uuid' })
  zoneId: string;

  @ManyToOne(() => ZonaEntity, { eager: true })
  @JoinColumn({ name: 'zona_id' })
  zone: ZonaEntity;

  // TODO(Zonas/Segmentos): null hasta que exista resolución zona→segmento.
  @Column({ name: 'segmento_ingreso_id', type: 'smallint', nullable: true })
  segmentId: number | null;

  @Column({ name: 'fecha', type: 'timestamptz' })
  date: Date;

  @Column({ name: 'valor_total', type: 'numeric', precision: 14, scale: 2 })
  totalValue: string;

  @Column({ name: 'numero_productos', type: 'int' })
  productCount: number;

  @Column({ name: 'unidades_totales', type: 'numeric', precision: 12, scale: 2 })
  unitsTotal: string;

  // Guarda el CONTEO real (lo que pide el profesor para el dashboard).
  // hasBasicProducts (booleano del contrato) se deriva de este campo.
  @Column({ name: 'productos_basicos', type: 'int', default: 0 })
  basicProductsCount: number;

  @CreateDateColumn({ name: 'construida_en', type: 'timestamptz' })
  builtAt: Date;
}