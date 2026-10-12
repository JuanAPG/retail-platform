import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsIn, IsOptional, IsUUID } from 'class-validator';

export const CHART_GROUPINGS = ['zone', 'segment'] as const;
export type ChartGrouping = (typeof CHART_GROUPINGS)[number];

/** M11 — Filtros de GET /elasticity/chart. */
export class ElasticityFilterDto {
  @ApiProperty({ description: 'Presentación a comparar entre zonas o segmentos.' })
  @IsDefined({ message: 'presentationId es obligatorio.' })
  @IsUUID('4', { message: 'presentationId debe ser un UUID válido.' })
  presentationId: string;

  @ApiPropertyOptional({
    enum: CHART_GROUPINGS,
    default: 'zone',
    description: 'Por segmento: promedio de las zonas del segmento, ponderado por observaciones (RN-02).',
  })
  @IsOptional()
  @IsIn(CHART_GROUPINGS, { message: "groupBy debe ser 'zone' o 'segment'." })
  groupBy?: ChartGrouping = 'zone';

  @ApiPropertyOptional({ description: 'Corrida a graficar. Sin ella, la más reciente con resultados de la presentación.' })
  @IsOptional()
  @IsUUID('4', { message: 'runId debe ser un UUID válido.' })
  runId?: string;
}
