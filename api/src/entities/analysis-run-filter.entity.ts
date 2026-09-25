import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { AnalysisRun } from './analysis-run.entity';

/** Valores del enum `dimension_analisis` en Postgres. */
export type AnalysisDimension = 'tienda' | 'zona' | 'segmento' | 'categoria' | 'producto';

/**
 * Filtro aplicado al dataset de una corrida (`analisis_corrida_filtros`):
 * los "datos usados". Sin filas = la corrida abarcó todo el periodo.
 *
 * `referencia_id` es texto porque apunta a llaves de tipos distintos
 * (uuid de tienda/zona/producto, smallint de segmento/categoría).
 */
@Entity({ name: 'analisis_corrida_filtros' })
export class AnalysisRunFilter {
  @PrimaryColumn({ name: 'corrida_id', type: 'uuid' })
  runId: string;

  @PrimaryColumn({ name: 'dimension', type: 'varchar' })
  dimension: AnalysisDimension;

  @PrimaryColumn({ name: 'referencia_id', type: 'text' })
  referenceId: string;

  @ManyToOne(() => AnalysisRun, (r) => r.filters, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'corrida_id' })
  run: AnalysisRun;
}
