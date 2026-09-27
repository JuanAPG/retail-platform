import { Column, Entity, PrimaryColumn } from 'typeorm';
import { AccessibilityComponentType, ACCESSIBILITY_COMPONENTS } from './accessibility-weight.entity';

/** Valor normalizado (0-1) de cada componente para una zona, en una corrida. */
@Entity({ name: 'accesibilidad_componentes' })
export class AccessibilityComponentEntity {
  @PrimaryColumn({ name: 'accesibilidad_id', type: 'uuid' })
  accesibilidadId: string;

  @PrimaryColumn({
    type: 'enum',
    enum: ACCESSIBILITY_COMPONENTS,
    enumName: 'componente_accesibilidad',
  })
  componente: AccessibilityComponentType;

  @Column({ type: 'numeric', precision: 10, scale: 4 })
  valor: string;
}