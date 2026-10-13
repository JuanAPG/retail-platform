import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Forma pública que exige el contrato (M13). No es una entidad: se arma. */
export class SimulationResultItem {
  @ApiProperty({ description: "Clave del indicador, ej. 'demanda_estimada', 'ingreso_estimado'" })
  indicatorKey: string;

  @ApiPropertyOptional({ nullable: true })
  zoneId: string | null;

  @ApiProperty()
  baseValue: number;

  @ApiProperty()
  simulatedValue: number;

  @ApiPropertyOptional({ nullable: true, description: '% de variación; null si baseValue es 0' })
  variationPct: number | null;
}

export class SimulationResult {
  @ApiProperty({ enum: ['price', 'presentation'] })
  type: 'price' | 'presentation';

  @ApiProperty()
  productId: string;

  @ApiProperty()
  presentationId: string;

  @ApiPropertyOptional({ nullable: true })
  zoneId: string | null;

  @ApiPropertyOptional({ nullable: true })
  segmentId: number | null;

  @ApiProperty({ type: Object })
  inputs: Record<string, unknown>;

  @ApiProperty({ type: [SimulationResultItem] })
  results: SimulationResultItem[];

  @ApiProperty({ description: 'Id del escenario guardado automáticamente con esta simulación' })
  scenarioId: string;

  @ApiPropertyOptional({ type: [String], description: 'Supuestos con los que se calculó y guardó el escenario' })
  assumptions?: string[];

  @ApiPropertyOptional()
  note?: string;
}
