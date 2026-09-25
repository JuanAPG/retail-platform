import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { AnalysisRun } from './analysis-run.entity';

/**
 * Parámetro de entrada de una corrida (`analisis_corrida_parametros`),
 * como fila clave/valor y no como JSON: así se pueden consultar y
 * comparar entre corridas. Ej. ('soporte_minimo', '0.05').
 */
@Entity({ name: 'analisis_corrida_parametros' })
export class AnalysisRunParameter {
  @PrimaryColumn({ name: 'corrida_id', type: 'uuid' })
  runId: string;

  @PrimaryColumn({ name: 'clave', type: 'varchar', length: 60 })
  key: string;

  /** Siempre texto; cada módulo lo interpreta según la clave. */
  @Column({ name: 'valor', type: 'text' })
  value: string;

  @ManyToOne(() => AnalysisRun, (r) => r.parameters, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'corrida_id' })
  run: AnalysisRun;
}
