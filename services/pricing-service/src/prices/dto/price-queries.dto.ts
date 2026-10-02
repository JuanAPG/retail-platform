import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
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
