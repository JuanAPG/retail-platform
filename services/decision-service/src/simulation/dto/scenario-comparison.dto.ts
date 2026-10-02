import { ApiProperty } from '@nestjs/swagger';

export class ScenarioComparisonRow {
  @ApiProperty()
  indicatorKey: string;

  @ApiProperty({ nullable: true })
  zoneId: string | null;

  @ApiProperty({ type: Object, description: 'valor_simulado de cada escenario, indexado por scenarioId' })
  valuesByScenario: Record<string, number>;
}

export class ScenarioComparison {
  @ApiProperty({ type: [String] })
  scenarioIds: string[];

  @ApiProperty({ type: Object, description: 'Nombre de cada escenario, indexado por su id' })
  scenarioNames: Record<string, string>;

  @ApiProperty({ type: [ScenarioComparisonRow] })
  rows: ScenarioComparisonRow[];
}
