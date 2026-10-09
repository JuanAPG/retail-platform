import { ApiProperty } from '@nestjs/swagger';
import { GRANULARITIES, Granularity } from './elasticity-params.dto';

/** Clasificación según el contrato (la base guarda 'elastica' | 'inelastica' | 'unitaria'). */
export const ELASTICITY_CLASSES = ['elastic', 'inelastic', 'unitary'] as const;
export type ElasticityClass = (typeof ELASTICITY_CLASSES)[number];

/** Una elasticidad calculada para una presentación en una zona o a nivel nacional. */
export class ElasticityResultItem {
  @ApiProperty()
  presentationId: string;

  @ApiProperty({ example: 'Leche entera' })
  productName: string;

  @ApiProperty({ example: '1 L' })
  presentationName: string;

  @ApiProperty({ nullable: true, type: String, description: 'null = agregado nacional.' })
  zoneId: string | null;

  @ApiProperty({ example: 'Nacional' })
  zoneName: string;

  @ApiProperty({ example: -1.35, description: 'Elasticidad E: % de cambio en la cantidad por cada 1 % de cambio en el precio.' })
  value: number;

  @ApiProperty({ enum: ELASTICITY_CLASSES })
  classification: ElasticityClass;

  @ApiProperty({ nullable: true, type: Number, example: 0.62 })
  rSquared: number | null;

  @ApiProperty({ example: 4 })
  observations: number;

  @ApiProperty({ description: 'true si E > 0: la demanda sube con el precio; no se lee como una elasticidad normal.' })
  atypical: boolean;
}

/** Una combinación presentación–zona que no tuvo datos suficientes para calcular. */
export class InsufficientElasticity {
  @ApiProperty()
  presentationId: string;

  @ApiProperty()
  productName: string;

  @ApiProperty()
  presentationName: string;

  @ApiProperty({ nullable: true, type: String })
  zoneId: string | null;

  @ApiProperty()
  zoneName: string;

  @ApiProperty()
  observations: number;

  @ApiProperty()
  distinctPrices: number;

  @ApiProperty({ example: 'Un solo precio en el periodo: no se puede medir la reacción al precio.' })
  reason: string;
}

/** M11 — Respuesta de POST /elasticity/calculate. */
export class ElasticityResult {
  @ApiProperty()
  runId: string;

  @ApiProperty({ example: '2026-08-05' })
  periodStart: string;

  @ApiProperty({ example: '2026-08-15' })
  periodEnd: string;

  @ApiProperty({ enum: GRANULARITIES })
  granularity: Granularity;

  @ApiProperty({ type: [ElasticityResultItem] })
  results: ElasticityResultItem[];

  @ApiProperty({ type: [InsufficientElasticity] })
  insufficient: InsufficientElasticity[];

  @ApiProperty({ type: [String] })
  assumptions: string[];
}
