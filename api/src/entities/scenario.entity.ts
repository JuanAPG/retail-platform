import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * M13 — Escenario de simulación (`escenarios`). `escenarioBaseId` permite
 * comparar contra otro escenario ya guardado; `corridaId` amarra el
 * escenario a una corrida de análisis si aplica.
 */
@Entity({ name: 'escenarios' })
export class Scenario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ name: 'escenario_base_id', type: 'uuid', nullable: true })
  escenarioBaseId: string | null;

  @Column({ name: 'corrida_id', type: 'uuid', nullable: true })
  corridaId: string | null;

  @Column({ name: 'zona_id', type: 'uuid', nullable: true })
  zonaId: string | null;

  @Column({ name: 'creado_por', type: 'uuid' })
  creadoPor: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
