import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min, Validate } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { EsFiltroDeFecha } from '../../common/zona-horaria';

/**
 * M06 — Filtros de consulta de transacciones. Todos opcionales y
 * combinables (AND). Hereda `?page&limit` del estándar de paginación.
 *
 * `zoneId` y `segmentId` son los mismos nombres que usan canastas (M07) e
 * indicadores (M09): una pantalla filtra los tres niveles con los mismos
 * parámetros. Aquí se resuelven por la TIENDA de la transacción, porque la
 * transacción es un nivel más arriba que la canasta y todavía no tiene
 * zona ni segmento propios.
 */
export class TransactionFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Solo transacciones de esta tienda.' })
  @IsOptional()
  @IsUUID('4', { message: 'storeId debe ser un UUID válido.' })
  storeId?: string;

  @ApiPropertyOptional({ description: 'Solo transacciones de tiendas de esta zona.' })
  @IsOptional()
  @IsUUID('4', { message: 'zoneId debe ser un UUID válido.' })
  zoneId?: string;

  @ApiPropertyOptional({
    description:
      'Solo transacciones de tiendas en zonas cuya clasificación vigente sea este segmento de ingreso.',
  })
  @IsOptional()
  // Los query params llegan como texto; sin @Type la validación falla.
  @Type(() => Number)
  @IsInt({ message: 'segmentId debe ser un número entero.' })
  @Min(1, { message: 'segmentId debe ser mayor a 0.' })
  segmentId?: number;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Desde esta fecha, inclusive.' })
  @IsOptional()
  @Validate(EsFiltroDeFecha)
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Hasta esta fecha, inclusive (día completo).' })
  @IsOptional()
  @Validate(EsFiltroDeFecha)
  dateTo?: string;
}
