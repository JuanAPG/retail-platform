import { ApiProperty } from '@nestjs/swagger';

/**
 * Tipos detectables con los datos disponibles. 'desabasto' existe en el
 * enum de la base, pero no hay historial de inventario para detectarlo.
 */
export const SUBSTITUTION_TYPES = ['precio', 'preferencia'] as const;
export type SubstitutionType = (typeof SUBSTITUTION_TYPES)[number];

/**
 * M11 — Un par de productos sustitutos (origen → destino) de una
 * categoría. El contrato devuelve un arreglo, así que el periodo y las
 * observaciones que respaldan el patrón van en cada elemento.
 */
export class SubstitutionPattern {
  @ApiProperty()
  originProductId: string;

  @ApiProperty({ example: 'Leche entera', description: 'A: el que sube de precio o se deja de comprar.' })
  originProductName: string;

  @ApiProperty()
  targetProductId: string;

  @ApiProperty({ example: 'Leche deslactosada', description: 'B: el que lo reemplaza.' })
  targetProductName: string;

  @ApiProperty({ enum: SUBSTITUTION_TYPES })
  type: SubstitutionType;

  @ApiProperty({ example: 0.64, description: 'Fuerza del patrón, 0–1.' })
  score: number;

  @ApiProperty({ example: 0.4, description: 'Coocurrencia en canastas; < 1 = casi no se compran juntos.' })
  lift: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Correlación entre el precio de A y las ventas de B; null si no hubo datos para calcularla.',
  })
  priceCorrelation: number | null;

  @ApiProperty({ description: 'Canastas (o periodos, para la correlación) que respaldan el patrón.' })
  observations: number;

  @ApiProperty({ example: '2026-08-05' })
  periodStart: string;

  @ApiProperty({ example: '2026-08-15' })
  periodEnd: string;
}
