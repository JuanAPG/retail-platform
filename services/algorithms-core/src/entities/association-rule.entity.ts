import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, ValueTransformer } from 'typeorm';
import { AnalysisRun } from './analysis-run.entity';
import { AssociationRuleItem } from './association-rule-item.entity';

/**
 * Postgres entrega NUMERIC como texto para no perder precisión. Soporte,
 * confianza y lift son razones con pocos decimales y viajan directo al
 * frontend, así que se leen como número.
 */
const numericAsNumber: ValueTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/**
 * M10 — Regla de asociación producida por una corrida de Apriori
 * (`reglas_asociacion`, RF-15). Los productos de cada lado viven en
 * `items`: el antecedente es un CONJUNTO, no un texto (1FN).
 */
@Entity({ name: 'reglas_asociacion' })
export class AssociationRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'corrida_id', type: 'uuid' })
  runId: string;

  @ManyToOne(() => AnalysisRun, (r) => r.results, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'corrida_id' })
  run: AnalysisRun;

  /** Fracción de canastas que contienen la regla completa (0–1). */
  @Column({ name: 'soporte', type: 'numeric', precision: 6, scale: 5, transformer: numericAsNumber })
  support: number;

  /** P(consecuente | antecedente), 0–1. */
  @Column({ name: 'confianza', type: 'numeric', precision: 6, scale: 5, transformer: numericAsNumber })
  confidence: number;

  /** confianza / soporte del consecuente; > 1 = asociación positiva. */
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true, transformer: numericAsNumber })
  lift: number | null;

  /** Canastas (= transacciones) que contienen la regla completa. */
  @Column({ name: 'transacciones_regla', type: 'int', nullable: true })
  transactionCount: number | null;

  @OneToMany(() => AssociationRuleItem, (i) => i.rule)
  items: AssociationRuleItem[];
}
