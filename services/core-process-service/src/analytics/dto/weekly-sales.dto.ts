import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Una semana de ventas de una presentación del producto. */
export class WeeklySalesRow {
  @ApiProperty({ example: '2026-07-06', description: 'Lunes de la semana, hora de Monterrey.' })
  weekStart: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })
  presentationId: string;

  @ApiProperty({ example: 214, description: 'Cantidad vendida, en la unidad de la presentación.' })
  quantity: number;

  @ApiProperty({ example: 61, description: 'Transacciones de esa semana con esa presentación.' })
  transactions: number;
}

/**
 * `GET /v1/analytics/weekly-sales`. Clase (no interface) para que Swagger
 * documente la respuesta. El orden de los campos es el del XSD
 * (`xsd/core-process/weekly-sales.xsd`, `xs:sequence`).
 */
export class WeeklySales {
  @ApiProperty()
  productId: string;

  @ApiPropertyOptional({ nullable: true })
  zoneId: string | null;

  @ApiPropertyOptional({ nullable: true })
  dateFrom: string | null;

  @ApiPropertyOptional({ nullable: true })
  dateTo: string | null;

  @ApiProperty({ example: 'America/Monterrey' })
  timezone: string;

  @ApiProperty({ example: 'monday' })
  weekStartsOn: 'monday';

  @ApiProperty({ example: '2026-11-25T18:04:11.902Z' })
  asOf: string;

  @ApiProperty({ example: 1184, description: 'Transacciones distintas con el producto (D-36).' })
  transactions: number;

  @ApiProperty({ example: 4, description: 'Tiendas distintas que vendieron el producto (D-36).' })
  stores: number;

  @ApiProperty({ type: [WeeklySalesRow] })
  data: WeeklySalesRow[];
}
