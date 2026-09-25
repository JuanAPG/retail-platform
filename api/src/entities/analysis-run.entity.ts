import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UsuarioEntity } from './usuario.entity';
import { AnalysisRunParameter } from './analysis-run-parameter.entity';
import { AnalysisRunAssumption } from './analysis-run-assumption.entity';
import { AnalysisRunFilter } from './analysis-run-filter.entity';
import { AssociationRule } from './association-rule.entity';

/** Valores del enum `tipo_corrida` en Postgres. */
export type AnalysisRunType =
  | 'descriptiva'
  | 'clasificacion_zona'
  | 'asociacion'
  | 'sustitucion'
  | 'elasticidad'
  | 'accesibilidad'
  | 'simulacion';

/** Valores del enum `estado_corrida` en Postgres. */
export type AnalysisRunStatus = 'en_proceso' | 'completada' | 'fallida';

/**
 * Corrida de análisis (`analisis_corridas`). Compartida: toda salida
 * calculada (Apriori, sustitución, elasticidad, accesibilidad,
 * simulación) cuelga de una corrida para poder responder con qué datos,
 * en qué periodo, quién y bajo qué supuestos se obtuvo (RF-15).
 *
 * Creada por M10 (Leonardo); M11–M13 la reutilizan en lugar de declarar
 * otra entidad sobre la misma tabla.
 *
 * El "dataset" de la corrida es el periodo + los conteos + los filtros.
 * `tipo` y `estado` son enums en Postgres; se mapean como varchar
 * (precedente: `importaciones.estado`), porque con `synchronize: false`
 * TypeORM no registra el enum, pero la columna real sí lo valida.
 */
@Entity({ name: 'analisis_corridas' })
export class AnalysisRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tipo', type: 'varchar' })
  type: AnalysisRunType;

  @Column({ name: 'estado', type: 'varchar', default: 'en_proceso' })
  status: AnalysisRunStatus;

  @Column({ name: 'ejecutada_por', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => UsuarioEntity, { nullable: true })
  @JoinColumn({ name: 'ejecutada_por' })
  user: UsuarioEntity | null;

  /** Cuándo se ejecutó; no confundir con el periodo de los datos. */
  @CreateDateColumn({ name: 'ejecutada_en', type: 'timestamptz' })
  date: Date;

  /** Periodo de los DATOS analizados, 'yyyy-mm-dd'. */
  @Column({ name: 'periodo_inicio', type: 'date' })
  periodStart: string;

  @Column({ name: 'periodo_fin', type: 'date' })
  periodEnd: string;

  @Column({ name: 'transacciones_consideradas', type: 'int', nullable: true })
  transactionsConsidered: number | null;

  @Column({ name: 'canastas_consideradas', type: 'int', nullable: true })
  basketsConsidered: number | null;

  /** Obligatorio cuando status = 'fallida' (chk_corrida_error). */
  @Column({ name: 'mensaje_error', type: 'text', nullable: true })
  errorMessage: string | null;

  @OneToMany(() => AnalysisRunParameter, (p) => p.run)
  parameters: AnalysisRunParameter[];

  @OneToMany(() => AnalysisRunAssumption, (a) => a.run)
  assumptions: AnalysisRunAssumption[];

  @OneToMany(() => AnalysisRunFilter, (f) => f.run)
  filters: AnalysisRunFilter[];

  /**
   * Resultados de una corrida de asociación (M10): sus reglas. Nombre
   * literal del Contrato de Métodos y Endpoints. En corridas de otro tipo
   * viene vacío: elasticidad, accesibilidad, etc. cuelgan sus resultados
   * de sus propias tablas.
   */
  @OneToMany(() => AssociationRule, (r) => r.run)
  results: AssociationRule[];
}
