import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export const GRANULARITIES = ['day', 'week'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

/**
 * M11 — Parámetros de POST /elasticity/calculate.
 *
 * No extiende los filtros de M09: la elasticidad siempre se calcula por
 * cada zona más el agregado nacional, y la comparación entre zonas o
 * segmentos la hace el gráfico.
 */
export class ElasticityParamsDto {
  @ApiPropertyOptional({ description: 'Presentación a calcular. Sin ella, todas las que tengan ventas en el periodo.' })
  @IsOptional()
  @IsUUID('4', { message: 'presentationId debe ser un UUID válido.' })
  presentationId?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString({}, { message: 'dateFrom debe ser una fecha ISO válida.' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'Inclusivo: abarca el día completo.' })
  @IsOptional()
  @IsDateString({}, { message: 'dateTo debe ser una fecha ISO válida.' })
  dateTo?: string;

  @ApiPropertyOptional({
    enum: GRANULARITIES,
    default: 'day',
    description:
      'Cómo se agrupan las ventas en observaciones (zona × periodo). Por día aprovecha mejor pocos datos; por semana es lo usual con más historia.',
  })
  @IsOptional()
  @IsIn(GRANULARITIES, { message: "granularity debe ser 'day' o 'week'." })
  granularity?: Granularity = 'day';
}
