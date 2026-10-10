import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min, Validate } from 'class-validator';
import { EsFiltroDeFecha } from '../../common/validators/filtro-de-fecha';

/**
 * M09 — Filtros comunes a todos los indicadores descriptivos. Todos
 * opcionales: sin filtros, el indicador se calcula sobre todas las
 * canastas. Mismos nombres que BasketFilterDto (M07) para que la
 * pantalla filtre canastas e indicadores con los mismos parámetros.
 *
 * El segmento es el de la ZONA donde se hizo la compra (RN-02): nunca
 * se infiere el ingreso de una persona a partir de su canasta.
 */
export class AnalyticsFilterDto {
  @ApiPropertyOptional({ description: 'Solo canastas de esta tienda.' })
  @IsOptional()
  @IsUUID('4', { message: 'storeId debe ser un UUID válido.' })
  storeId?: string;

  @ApiPropertyOptional({ description: 'Solo canastas de esta zona.' })
  @IsOptional()
  @IsUUID('4', { message: 'zoneId debe ser un UUID válido.' })
  zoneId?: string;

  @ApiPropertyOptional({ description: 'Solo canastas de zonas de este segmento de ingreso.' })
  @IsOptional()
  // Los query params llegan como texto; sin @Type la validación falla.
  @Type(() => Number)
  @IsInt({ message: 'segmentId debe ser un número entero.' })
  @Min(1, { message: 'segmentId debe ser mayor a 0.' })
  segmentId?: number;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Día YYYY-MM-DD; si trae hora, solo se usa el día.' })
  @IsOptional()
  @Validate(EsFiltroDeFecha)
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'Día YYYY-MM-DD; si trae hora, solo se usa el día. Inclusivo: abarca el día completo.',
  })
  @IsOptional()
  @Validate(EsFiltroDeFecha)
  dateTo?: string;
}
