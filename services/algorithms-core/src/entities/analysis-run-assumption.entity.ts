import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { AnalysisRun } from './analysis-run.entity';

/**
 * Supuesto declarado de una corrida (`analisis_corrida_supuestos`), en
 * orden. Sin supuestos un resultado analítico no es interpretable.
 */
@Entity({ name: 'analisis_corrida_supuestos' })
export class AnalysisRunAssumption {
  @PrimaryColumn({ name: 'corrida_id', type: 'uuid' })
  runId: string;

  @PrimaryColumn({ name: 'orden', type: 'smallint' })
  order: number;

  @Column({ name: 'supuesto', type: 'text' })
  assumption: string;

  @ManyToOne(() => AnalysisRun, (r) => r.assumptions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'corrida_id' })
  run: AnalysisRun;
}
