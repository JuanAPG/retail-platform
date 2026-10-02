import { Column, Entity, PrimaryColumn } from 'typeorm';

export type RecommendationEvidenceDimension = 'tienda' | 'zona' | 'segmento' | 'categoria' | 'producto';

export const RECOMMENDATION_EVIDENCE_DIMENSIONS: RecommendationEvidenceDimension[] = [
  'tienda',
  'zona',
  'segmento',
  'categoria',
  'producto',
];

/** "Con qué datos": evidencia concreta que respalda una recomendación. */
@Entity({ name: 'recomendacion_evidencias' })
export class RecommendationEvidence {
  @PrimaryColumn({ name: 'recomendacion_id', type: 'uuid' })
  recomendacionId: string;

  @PrimaryColumn({
    type: 'enum',
    enum: RECOMMENDATION_EVIDENCE_DIMENSIONS,
    enumName: 'dimension_analisis',
  })
  dimension: RecommendationEvidenceDimension;

  @PrimaryColumn({ name: 'referencia_id', type: 'text' })
  referenciaId: string;

  @Column({ type: 'text' })
  descripcion: string;
}
