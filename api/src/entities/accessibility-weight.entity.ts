import { Column, Entity, PrimaryColumn } from 'typeorm';

export type AccessibilityComponentType =
  | 'precio'
  | 'ingreso_segmento'
  | 'disponibilidad'
  | 'cobertura_basicos';

export const ACCESSIBILITY_COMPONENTS: AccessibilityComponentType[] = [
  'precio',
  'ingreso_segmento',
  'disponibilidad',
  'cobertura_basicos',
];

/**
 * Ponderación de cada componente del índice, una vez por corrida
 * (`accesibilidad_pesos`). Con pesos iguales de arranque (0.25 c/u):
 * no hay evidencia para justificar otra distribución todavía, y como
 * el peso vive por corrida se puede ajustar después sin migración.
 */
@Entity({ name: 'accesibilidad_pesos' })
export class AccessibilityWeightEntity {
  @PrimaryColumn({ name: 'corrida_id', type: 'uuid' })
  corridaId: string;

  @PrimaryColumn({
    type: 'enum',
    enum: ACCESSIBILITY_COMPONENTS,
    enumName: 'componente_accesibilidad',
  })
  componente: AccessibilityComponentType;

  @Column({ type: 'numeric', precision: 5, scale: 4 })
  peso: string;
}