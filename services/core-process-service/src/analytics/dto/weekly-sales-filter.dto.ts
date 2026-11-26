import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID, Validate } from 'class-validator';
import { EsFiltroDeFecha } from '../../common/zona-horaria';

/**
 * Filtros de `GET /v1/analytics/weekly-sales` (T-13, consumidor:
 * demand-forecast-service). El producto es obligatorio: la serie es de UN
 * producto. Los demás filtros se llaman y se aplican igual que en
 * `AnalyticsFilterDto`, para que la serie cuadre con los indicadores.
 */
export class WeeklySalesFilterDto {
  @ApiProperty({ description: 'Producto de la serie (sus presentaciones van por separado).' })
  @IsUUID('4', { message: 'productId debe ser un UUID válido.' })
  productId: string;

  @ApiPropertyOptional({ description: 'Solo canastas de esta zona (la congelada en la canasta).' })
  @IsOptional()
  @IsUUID('4', { message: 'zoneId debe ser un UUID válido.' })
  zoneId?: string;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @Validate(EsFiltroDeFecha)
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-11-22' })
  @IsOptional()
  @Validate(EsFiltroDeFecha)
  dateTo?: string;

  @ApiPropertyOptional({
    example: '2026-11-25T18:04:11.902Z',
    description:
      'Instantánea: solo cuentan las canastas construidas hasta este instante. ' +
      'Sin él, el servidor usa el instante de la petición y lo devuelve.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'asOf debe ser un instante ISO 8601.' })
  asOf?: string;
}
