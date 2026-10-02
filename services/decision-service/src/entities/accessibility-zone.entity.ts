import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * M12 — Índice de accesibilidad de una zona, calculado en una corrida
 * específica (`analisis_corridas`). El desglose por componente vive en
 * `AccessibilityComponentEntity`; los pesos usados, en
 * `AccessibilityWeightEntity`.
 */
@Entity({ name: 'accesibilidad_zona' })
export class AccessibilityZoneEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'corrida_id', type: 'uuid' })
  corridaId: string;

  @Column({ name: 'zona_id', type: 'uuid' })
  zonaId: string;

  @Column({ type: 'numeric', precision: 6, scale: 4 })
  indice: string;
}
