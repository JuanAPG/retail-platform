import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { IsFechaCalendario } from '../../common/validators/fecha-calendario';

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
  @IsFechaCalendario({ message: 'dateFrom debe ser una fecha válida YYYY-MM-DD.' })
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Hasta esta fecha (YYYY-MM-DD): trae los precios que empezaron en ella o antes.' })
  @IsOptional()
  @IsFechaCalendario({ message: 'dateTo debe ser una fecha válida YYYY-MM-DD.' })
  dateTo?: string;
}
