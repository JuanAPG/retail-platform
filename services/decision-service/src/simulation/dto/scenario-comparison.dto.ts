import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScenarioType } from './scenario-summary.dto';

export class ScenarioComparisonResult {
  @ApiProperty()
  indicatorKey: string;

  @ApiPropertyOptional({ nullable: true })
  zoneId: string | null;

  @ApiProperty()
  baseValue: number;

  @ApiProperty()
  simulatedValue: number;

  @ApiProperty({ description: 'simulatedValue - baseValue' })
  difference: number;

  @ApiPropertyOptional({ nullable: true, description: '% de variación; null si baseValue es 0' })
  variationPct: number | null;
}

export class ScenarioComparisonEntry {
  @ApiProperty()
  scenarioId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['precio', 'presentacion', 'desconocido'] })
  type: ScenarioType | 'desconocido';

  @ApiPropertyOptional({ nullable: true })
  zoneId: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Elasticidad con la que se calculó el escenario' })
  elasticity: number | null;

  @ApiPropertyOptional({ nullable: true })
  elasticityRunId: string | null;

  @ApiProperty({ type: [ScenarioComparisonResult] })
  results: ScenarioComparisonResult[];
}

/**
 * Respuesta de GET /v1/simulation/compare. Es una lista por escenario y no
 * un mapa indexado por id: un UUID no es un nombre de elemento XML válido.
 */
export class ScenarioComparison {
  @ApiProperty({ type: [String] })
  scenarioIds: string[];

  @ApiProperty({ type: [ScenarioComparisonEntry] })
  scenarios: ScenarioComparisonEntry[];

  @ApiProperty({ type: [String], description: 'Por ejemplo, si se mezclan tipos de escenario' })
  warnings: string[];
}
