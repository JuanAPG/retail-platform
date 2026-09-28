import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type RecommendationStatus = 'propuesta' | 'aceptada' | 'descartada';

export const RECOMMENDATION_STATUSES: RecommendationStatus[] = ['propuesta', 'aceptada', 'descartada'];

/**
 * M14 — Recomendación de un motor de reglas (no IA). Las 4 columnas de
 * texto responden lo que exige el schema: qué recomienda, por qué, con
 * qué datos (evidencia, en RecommendationEvidence) y qué impacto estima.
 */
@Entity({ name: 'recomendaciones' })
export class Recommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'corrida_id', type: 'uuid', nullable: true })
  corridaId: string | null;

  @Column({ name: 'escenario_id', type: 'uuid', nullable: true })
  escenarioId: string | null;

  @Column({ name: 'zona_id', type: 'uuid', nullable: true })
  zonaId: string | null;

  @Column({ type: 'varchar', length: 200 })
  titulo: string;

  @Column({ name: 'que_recomienda', type: 'text' })
  queRecomienda: string;

  @Column({ name: 'por_que', type: 'text' })
  porQue: string;

  @Column({ name: 'impacto_estimado', type: 'text' })
  impactoEstimado: string;

  @Column({
    type: 'enum',
    enum: RECOMMENDATION_STATUSES,
    enumName: 'estatus_recomendacion',
    default: 'propuesta',
  })
  estatus: RecommendationStatus;

  @CreateDateColumn({ name: 'generada_en', type: 'timestamptz' })
  generadaEn: Date;
}
