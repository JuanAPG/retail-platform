import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ScenarioChangeType = 'precio' | 'empaque' | 'descuento' | 'disponibilidad';

export const SCENARIO_CHANGE_TYPES: ScenarioChangeType[] = [
  'precio',
  'empaque',
  'descuento',
  'disponibilidad',
];

/** Qué se cambió en el escenario: de cuánto a cuánto, por presentación. */
@Entity({ name: 'escenario_cambios' })
export class ScenarioChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'escenario_id', type: 'uuid' })
  escenarioId: string;

  @Column({ name: 'presentacion_id', type: 'uuid' })
  presentacionId: string;

  @Column({
    type: 'enum',
    enum: SCENARIO_CHANGE_TYPES,
    enumName: 'tipo_cambio_escenario',
  })
  tipo: ScenarioChangeType;

  @Column({ name: 'valor_anterior', type: 'numeric', precision: 12, scale: 4, nullable: true })
  valorAnterior: string | null;

  @Column({ name: 'valor_nuevo', type: 'numeric', precision: 12, scale: 4 })
  valorNuevo: string;
}
