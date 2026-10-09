import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SimulationResultItem } from './simulation-result.dto';

export type PresentationPriceStatus = 'con_precio' | 'sin_precio_en_la_zona' | 'sin_precio_vigente';

/**
 * Indicador analítico, no una medida de bienestar, y nunca solo "precio
 * bajo": cruza el desembolso con el ingreso del SEGMENTO de la zona.
 */
export class PresentationAccessibilityEffect {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Desembolso como % del ingreso mensual estimado del segmento de la zona. Null sin zona o sin segmento vigente.',
  })
  incomeSharePct: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Sobreprecio por unidad base (%) frente a la presentación más barata por unidad; 0 = la más barata.',
  })
  unitPricePremiumPct: number | null;
}

export class PresentationComparisonItem {
  @ApiProperty()
  presentationId: string;

  @ApiProperty({ example: '500 g' })
  presentationName: string;

  @ApiProperty({ enum: ['con_precio', 'sin_precio_en_la_zona', 'sin_precio_vigente'] })
  priceStatus: PresentationPriceStatus;

  @ApiPropertyOptional({ nullable: true, description: 'Desembolso: precio vigente promedio. Null si no hay precio.' })
  outlay: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Precio por unidad base (kg, l, pza, m). Null si no hay precio.' })
  unitPrice: number | null;

  @ApiProperty({ example: 'kg' })
  baseUnit: string;

  @ApiPropertyOptional({ nullable: true, description: 'Unidades vendidas en el histórico. Null si no hay precio.' })
  estimatedDemand: number | null;

  @ApiPropertyOptional({ nullable: true, type: PresentationAccessibilityEffect })
  accessibilityEffect: PresentationAccessibilityEffect | null;
}

/** Respuesta de POST /v1/simulation/presentation (D-14). */
export class PresentationComparisonResult {
  @ApiProperty({ enum: ['presentacion'] })
  type: 'presentacion';

  @ApiProperty({ description: 'Id del escenario guardado automáticamente con esta comparación' })
  scenarioId: string;

  @ApiProperty()
  productId: string;

  @ApiProperty()
  productName: string;

  @ApiPropertyOptional({ nullable: true })
  zoneId: string | null;

  @ApiPropertyOptional({ nullable: true })
  segmentId: number | null;

  @ApiProperty({ type: [PresentationComparisonItem] })
  presentations: PresentationComparisonItem[];

  @ApiProperty({ description: 'Presentación de referencia (valor base de `results`)' })
  referencePresentationId: string;

  @ApiProperty({ description: 'Presentación contra la que se compara la referencia (valor simulado de `results`)' })
  comparedPresentationId: string;

  @ApiProperty({ type: [SimulationResultItem] })
  results: SimulationResultItem[];

  @ApiProperty({ type: [String] })
  assumptions: string[];

  @ApiProperty({ type: [String] })
  warnings: string[];
}
