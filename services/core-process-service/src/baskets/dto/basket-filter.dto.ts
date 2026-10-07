import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/** Tamaños de compra de RN-05 (catálogo `tamanos_compra`). */
export const TAMANOS_COMPRA = ['chica', 'mediana', 'grande'] as const;
export type TamanoCompra = (typeof TAMANOS_COMPRA)[number];

/**
 * M07 — Filtros de consulta de canastas. Todos opcionales y combinables
 * entre sí: se aplican con AND, así que el resultado es la intersección.
 *
 * Mismos nombres que `AnalyticsFilterDto` (M09) para que la pantalla
 * filtre canastas e indicadores con los mismos parámetros, más los de
 * valor/tamaño que solo tienen sentido sobre la canasta.
 */
export class BasketFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Solo canastas vendidas en esta tienda.' })
  @IsOptional()
  @IsUUID('4', { message: 'storeId debe ser un UUID válido.' })
  storeId?: string;

  @ApiPropertyOptional({ description: 'Zona congelada al construir la canasta.' })
  @IsOptional()
  @IsUUID('4', { message: 'zoneId debe ser un UUID válido.' })
  zoneId?: string;

  @ApiPropertyOptional({ example: 2, description: 'Segmento de ingreso de la zona (RN-02).' })
  @IsOptional()
  // Los query params llegan como texto; sin @Type la validación falla y el
  // valor crudo acabaría en una columna SMALLINT (500 en vez de 400).
  @Type(() => Number)
  @IsInt({ message: 'segmentId debe ser un número entero.' })
  @Min(1, { message: 'segmentId debe ser mayor a 0.' })
  segmentId?: number;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Desde esta fecha, inclusive.' })
  @IsOptional()
  @IsDateString({}, { message: 'dateFrom debe ser una fecha ISO válida.' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Hasta esta fecha, inclusive (día completo).' })
  @IsOptional()
  @IsDateString({}, { message: 'dateTo debe ser una fecha ISO válida.' })
  dateTo?: string;

  @ApiPropertyOptional({ example: 100, description: 'Valor total mínimo de la canasta.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'minTotalValue debe ser numérico.' })
  @Min(0, { message: 'minTotalValue no puede ser negativo.' })
  minTotalValue?: number;

  @ApiPropertyOptional({ example: 500, description: 'Valor total máximo de la canasta.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'maxTotalValue debe ser numérico.' })
  @Min(0, { message: 'maxTotalValue no puede ser negativo.' })
  maxTotalValue?: number;

  @ApiPropertyOptional({ example: 2, description: 'Número mínimo de productos distintos.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minProductCount debe ser un número entero.' })
  @Min(0, { message: 'minProductCount no puede ser negativo.' })
  minProductCount?: number;

  @ApiPropertyOptional({ example: 10, description: 'Número máximo de productos distintos.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxProductCount debe ser un número entero.' })
  @Min(0, { message: 'maxProductCount no puede ser negativo.' })
  maxProductCount?: number;

  @ApiPropertyOptional({
    example: true,
    description: '`true`: solo canastas con al menos un producto de la canasta básica. `false`: solo sin ninguno.',
  })
  @IsOptional()
  // `?hasBasicProducts=false` llega como la cadena "false", y `Boolean('false')`
  // es `true`: hay que mapear a mano. Cualquier otro texto queda sin
  // convertir para que `@IsBoolean` lo rechace con 400 en vez de colarse.
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean({ message: 'hasBasicProducts debe ser true o false.' })
  hasBasicProducts?: boolean;

  @ApiPropertyOptional({
    enum: TAMANOS_COMPRA,
    description: 'Tamaño de compra (RN-05). Se resuelve contra el catálogo `tamanos_compra`, no se guarda en la canasta.',
  })
  @IsOptional()
  @IsIn(TAMANOS_COMPRA, { message: `size debe ser uno de: ${TAMANOS_COMPRA.join(', ')}.` })
  size?: TamanoCompra;
}
