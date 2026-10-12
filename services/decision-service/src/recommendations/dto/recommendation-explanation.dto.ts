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

/** Elemento de `GET /v1/recommendations` (mismos nombres que `explain`, sin evidencia). */
export class RecommendationSummary {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  whatRecommends: string;

  @ApiProperty()
  why: string;

  @ApiProperty()
  estimatedImpact: string;

  @ApiProperty({ type: String, nullable: true })
  zoneId: string | null;

  @ApiProperty({ type: String, nullable: true })
  scenarioId: string | null;

  @ApiProperty({ type: String, nullable: true })
  runId: string | null;

  @ApiProperty({ enum: ['propuesta', 'aceptada', 'descartada'] })
  status: string;

  @ApiProperty()
  generatedAt: Date;
}

/** Envoltura de la paginación estándar, solo para documentarla en Swagger. */
export class RecommendationPage {
  @ApiProperty({ type: [RecommendationSummary] })
  data: RecommendationSummary[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
