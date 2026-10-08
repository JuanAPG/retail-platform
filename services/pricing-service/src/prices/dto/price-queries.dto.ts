import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/** Query de `GET /v1/prices/history`: producto (obligatorio), presentación (opcional) y paginación. */
export class PriceHistoryQueryDto extends PaginationDto {
  @ApiProperty({ description: 'Id del producto (UUID).' })
  @IsUUID(undefined, { message: 'productId es obligatorio y debe ser un UUID.' })
  productId: string;

  @ApiPropertyOptional({ description: 'Id de una presentación de ese producto (UUID).' })
  @IsOptional()
  @IsUUID(undefined, { message: 'presentationId debe ser un UUID.' })
  presentationId?: string;
}

/** Query de `GET /v1/prices/compare-zones`. */
export class PriceComparisonQueryDto {
  @ApiProperty({ description: 'Id del producto (UUID).' })
  @IsUUID(undefined, { message: 'productId es obligatorio y debe ser un UUID.' })
  productId: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Query de `GET /v1/prices/current`: el precio ACTUAL (por fecha) de una presentación, por tienda. */
export class PriceCurrentQueryDto extends PaginationDto {
  @ApiProperty({ description: 'Id de la presentación (UUID).' })
  @IsUUID(undefined, { message: 'presentationId es obligatorio y debe ser un UUID.' })
  presentationId: string;

  @ApiPropertyOptional({ description: 'Solo las tiendas de esta zona (UUID).' })
  @IsOptional()
  @IsUUID(undefined, { message: 'zoneId debe ser un UUID.' })
  zoneId?: string;

  @ApiPropertyOptional({ description: 'Solo esta tienda (UUID).' })
  @IsOptional()
  @IsUUID(undefined, { message: 'storeId debe ser un UUID.' })
  storeId?: string;
}

/** Query de `GET /v1/prices/series`: historial completo de una presentación, sin paginar. */
export class PriceSeriesQueryDto {
  @ApiProperty({ description: 'Id de la presentación (UUID).' })
  @IsUUID(undefined, { message: 'presentationId es obligatorio y debe ser un UUID.' })
  presentationId: string;

  @ApiPropertyOptional({ description: 'Desde esta fecha (YYYY-MM-DD): trae los precios cuya vigencia llega a ella o después.' })
  @IsOptional()
  @Matches(FECHA, { message: 'dateFrom debe ser YYYY-MM-DD.' })
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Hasta esta fecha (YYYY-MM-DD): trae los precios que empezaron en ella o antes.' })
  @IsOptional()
  @Matches(FECHA, { message: 'dateTo debe ser YYYY-MM-DD.' })
  dateTo?: string;
}
