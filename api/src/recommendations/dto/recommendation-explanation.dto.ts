import { ApiProperty } from '@nestjs/swagger';

export class RecommendationEvidenceItem {
  @ApiProperty({ enum: ['tienda', 'zona', 'segmento', 'categoria', 'producto'] })
  dimension: string;

  @ApiProperty()
  referenceId: string;

  @ApiProperty()
  description: string;
}

/** Forma pública que exige el contrato (M14) para `explain`. */
export class RecommendationExplanation {
  @ApiProperty()
  recommendationId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  whatRecommends: string;

  @ApiProperty()
  why: string;

  @ApiProperty()
  estimatedImpact: string;

  @ApiProperty({ type: [RecommendationEvidenceItem] })
  evidence: RecommendationEvidenceItem[];

  @ApiProperty({ enum: ['propuesta', 'aceptada', 'descartada'] })
  status: string;

  @ApiProperty()
  generatedAt: Date;
}
