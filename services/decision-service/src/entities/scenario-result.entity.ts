import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Impacto estimado de un escenario sobre un indicador (y zona, si aplica).
 * `variacion_pct` la calcula la base sola (columna GENERATED): no se
 * escribe desde el código.
 */
@Entity({ name: 'escenario_resultados' })
export class ScenarioResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'escenario_id', type: 'uuid' })
  escenarioId: string;

  @Column({ name: 'indicador_id', type: 'smallint' })
  indicadorId: number;

  @Column({ name: 'zona_id', type: 'uuid', nullable: true })
  zonaId: string | null;

  @Column({ name: 'valor_base', type: 'numeric', precision: 16, scale: 4 })
  valorBase: string;

  @Column({ name: 'valor_simulado', type: 'numeric', precision: 16, scale: 4 })
  valorSimulado: string;
}
