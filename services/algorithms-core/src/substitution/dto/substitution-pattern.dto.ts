import { ApiProperty } from '@nestjs/swagger';

/**
 * Tipos detectables con los datos disponibles. 'desabasto' existe en el
 * enum de la base, pero no hay historial de inventario para detectarlo.
 */
export const SUBSTITUTION_TYPES = ['precio', 'preferencia'] as const;
export type SubstitutionType = (typeof SUBSTITUTION_TYPES)[number];

/**
 * M11 — Un indicio de sustitución entre dos productos (A → B) de una
 * categoría. El contrato devuelve un arreglo, así que el periodo y las
 * observaciones que respaldan el patrón van en cada elemento. Describe cómo
 * se compró; no prueba que el precio cause el cambio.
 */
export class SubstitutionPattern {
  @ApiProperty()
  originProductId: string;

  @ApiProperty({ example: 'Leche entera', description: 'A: el que se compra menos (por ejemplo, cuando está más caro).' })
  originProductName: string;

  @ApiProperty()
  targetProductId: string;

  @ApiProperty({ example: 'Queso panela', description: 'B: el que se compra en su lugar con más frecuencia (indicio).' })
  targetProductName: string;

  @ApiProperty({ enum: SUBSTITUTION_TYPES })
  type: SubstitutionType;

  @ApiProperty({ example: 0.64, description: 'Fuerza del indicio, 0–1.' })
  score: number;

  @ApiProperty({ example: 0.4, description: 'Coocurrencia en canastas; < 1 = casi no se compran juntos.' })
  lift: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Correlación entre el precio de A y que la canasta lleve B; null si no hubo datos para calcularla.',
  })
  priceCorrelation: number | null;

  @ApiProperty({ description: 'Canastas de la categoría que respaldan el patrón.' })
  observations: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 0.15,
    description: 'Variación del precio de A en el periodo: (máximo − mínimo) / mínimo. null si A no tiene precios.',
  })
  priceVariation: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: -0.42,
    description:
      'Proporción de canastas que llevan A cuando A está caro menos cuando está barato (corte en el punto medio ' +
      'de su precio). null si el precio de A no cambió.',
  })
  originFrequencyChange: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 0.38,
    description: 'Lo mismo para B: positiva = más canastas llevan B cuando A está caro.',
  })
  targetFrequencyChange: number | null;

  @ApiProperty({
    example:
      'Indicio de sustitución por precio: cuando Leche entera estuvo más caro, más canastas llevaron Queso panela (r = 0.52). ' +
      'No prueba que una cosa cause la otra.',
  })
  summary: string;

  @ApiProperty({ example: '2026-08-05' })
  periodStart: string;

  @ApiProperty({ example: '2026-08-15' })
  periodEnd: string;
}
