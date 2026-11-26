import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Canastas, tiendas y gasto de un periodo del grupo. */
export class BasketPeriod {
  @ApiPropertyOptional({ nullable: true, example: '2026-10-01', description: 'Nulo sin groupBy.' })
  periodStart: string | null;

  @ApiProperty({ example: 100 })
  baskets: number;

  @ApiProperty({ example: 4, description: 'Tiendas distintas con venta en el periodo (D-36).' })
  stores: number;

  @ApiProperty({ example: 10983.5, description: 'MXN.' })
  totalSpend: number;
}

/** Un producto en un periodo: en cuántas canastas distintas aparece y cuánto se gastó. */
export class BasketProductRow {
  @ApiPropertyOptional({ nullable: true, example: '2026-10-01', description: 'Nulo sin groupBy.' })
  periodStart: string | null;

  @ApiProperty()
  productId: string;

  @ApiProperty({ example: 'Leche entera' })
  productName: string;

  @ApiPropertyOptional({ nullable: true, example: 2 })
  categoryId: number | null;

  @ApiProperty({
    example: 62,
    description: 'Canastas distintas con el producto: varias presentaciones cuentan una vez.',
  })
  basketsWithProduct: number;

  @ApiProperty({ example: 3534, description: 'Suma de subtotales del producto, MXN.' })
  spend: number;
}

/**
 * `GET /v1/analytics/basket-products`. El orden de los campos es el del XSD
 * (`xsd/core-process/basket-products.xsd`, `xs:sequence`).
 */
export class BasketProducts {
  @ApiProperty()
  zoneId: string;

  @ApiProperty({ example: 2 })
  segmentId: number;

  @ApiPropertyOptional({ nullable: true })
  dateFrom: string | null;

  @ApiPropertyOptional({ nullable: true })
  dateTo: string | null;

  @ApiPropertyOptional({ nullable: true, enum: ['week', 'month'] })
  groupBy: 'week' | 'month' | null;

  @ApiProperty({ example: 'America/Monterrey' })
  timezone: string;

  @ApiProperty({ example: '2026-11-25T18:20:00.000Z' })
  asOf: string;

  @ApiProperty({ type: [BasketPeriod] })
  periods: BasketPeriod[];

  @ApiProperty({ type: [BasketProductRow] })
  data: BasketProductRow[];
}
