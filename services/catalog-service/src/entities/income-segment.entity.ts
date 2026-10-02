import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * M05 — Segmento de ingreso. Clasifica ZONAS agregadas, nunca personas
 * (RN-02): el ingreso se asigna por zona, jamás se infiere de una compra
 * individual. `source`, `updateFrequency`, `zoneRelation` y `limitations`
 * documentan la justificación que exigió la retroalimentación del
 * profesor (fuente, frecuencia de actualización, relación con zona y
 * limitaciones del criterio).
 */
@Entity({ name: 'segmentos_ingreso' })
export class IncomeSegment {
  @PrimaryGeneratedColumn({ type: 'smallint' })
  id: number;

  @Column({ name: 'codigo', type: 'varchar', length: 20, unique: true })
  code: string;

  @Column({ name: 'nombre', type: 'varchar', length: 60, unique: true })
  name: string;

  @Column({ name: 'ingreso_min', type: 'numeric', precision: 12, scale: 2 })
  incomeRangeMin: string;

  @Column({ name: 'ingreso_max', type: 'numeric', precision: 12, scale: 2, nullable: true })
  incomeRangeMax: string | null;

  @Column({ name: 'fuente', type: 'text' })
  source: string;

  @Column({ name: 'frecuencia_actualizacion', type: 'varchar', length: 60 })
  updateFrequency: string;

  @Column({ name: 'relacion_zona', type: 'text' })
  zoneRelation: string;

  @Column({ name: 'limitaciones', type: 'text' })
  limitations: string;

  @Column({ name: 'descripcion', type: 'text', nullable: true })
  description: string | null;
}
