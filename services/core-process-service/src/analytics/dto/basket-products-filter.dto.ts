import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Min, Validate } from 'class-validator';
import { EsFiltroDeFecha } from '../../common/zona-horaria';

export const AGRUPACIONES = ['week', 'month'] as const;
export type Agrupacion = (typeof AGRUPACIONES)[number];

/**
 * Filtros de `GET /v1/analytics/basket-products` (T-12, consumidor:
 * basket-analysis-service). El grupo es zona + segmento congelado en la
 * canasta (D-37, RN-02): los dos son obligatorios.
 */
export class BasketProductsFilterDto {
  @ApiProperty({ description: 'Zona del grupo (la congelada en la canasta).' })
  @IsUUID('4', { message: 'zoneId debe ser un UUID válido.' })
  zoneId: string;

  @ApiProperty({ description: 'Segmento del grupo (el congelado en la canasta).' })
  // Los query params llegan como texto; sin @Type la validación falla.
  @Type(() => Number)
  @IsInt({ message: 'segmentId debe ser un número entero.' })
  @Min(1, { message: 'segmentId debe ser mayor a 0.' })
  segmentId: number;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @Validate(EsFiltroDeFecha)
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @Validate(EsFiltroDeFecha)
  dateTo?: string;

  @ApiPropertyOptional({
    enum: AGRUPACIONES,
    description: 'Un periodo por semana (lunes) o mes, hora de Monterrey. Sin él, un solo periodo.',
  })
  @IsOptional()
  @IsIn(AGRUPACIONES, { message: 'groupBy debe ser week o month.' })
  groupBy?: Agrupacion;

  @ApiPropertyOptional({
    example: '2026-11-25T18:20:00.000Z',
    description:
      'Instantánea: solo cuentan las canastas construidas hasta este instante. ' +
      'Sin él, el servidor usa el instante de la petición y lo devuelve.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'asOf debe ser un instante ISO 8601.' })
  asOf?: string;
}
