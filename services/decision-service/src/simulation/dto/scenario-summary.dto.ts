import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PresentationComparisonItem } from './presentation-comparison-result.dto';

export type ScenarioType = 'precio' | 'presentacion';

/** Indicador del escenario tal como se calculó al guardarlo. */
export interface ScenarioSnapshotResult {
  indicatorKey: string;
  zoneId: string | null;
  baseValue: number;
  simulatedValue: number;
}

/**
 * Lo que se guarda como JSON en `escenarios.descripcion`: tipo e insumos
 * CON LOS QUE SE CALCULÓ el escenario. Es una foto: si la elasticidad o
 * los precios cambian después, el escenario sigue mostrando los de ese
 * momento. No hay columna `tipo` en `escenarios`, por eso vive aquí.
 */
export interface ScenarioSnapshot {
  version: 1;
  type: ScenarioType;
  productId: string;
  /** Solo en escenarios de precio (uno de presentación evalúa varias). */
  presentationId: string | null;
  elasticity: number | null;
  elasticityRunId: string | null;
  currentPrice: number | null;
  newPrice: number | null;
  baseDemand: number | null;
  /** Solo en escenarios de presentación: precio y demanda por presentación. */
  presentations: PresentationComparisonItem[];
  assumptions: string[];
  warnings: string[];
  results: ScenarioSnapshotResult[];
}

/** Elemento de GET /v1/simulation/scenarios. */
export class ScenarioSummary {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['precio', 'presentacion', 'desconocido'] })
  type: ScenarioType | 'desconocido';

  @ApiPropertyOptional({ nullable: true })
  zoneId: string | null;

  @ApiPropertyOptional({ nullable: true })
  productId: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Solo en escenarios de precio' })
  presentationId: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Elasticidad con la que se calculó (no la vigente hoy)' })
  elasticity: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Corrida de elasticidad de la que se tomó' })
  elasticityRunId: string | null;

  @ApiPropertyOptional({ nullable: true })
  currentPrice: number | null;

  @ApiPropertyOptional({ nullable: true })
  newPrice: number | null;

  @ApiPropertyOptional({ nullable: true })
  baseDemand: number | null;

  @ApiProperty({ type: [PresentationComparisonItem], description: 'Presentaciones evaluadas (tipo presentacion)' })
  presentations: PresentationComparisonItem[];

  @ApiProperty({ type: [String] })
  assumptions: string[];

  @ApiProperty()
  createdBy: string;

  @ApiProperty()
  createdAt: Date;
}

/** Envoltura de la paginación estándar, solo para documentarla en Swagger. */
export class ScenarioPage {
  @ApiProperty({ type: [ScenarioSummary] })
  data: ScenarioSummary[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
