import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Query de `GET /v1/field-visits` (D-52). Por tienda, zona y fecha; nunca por persona. */
export class FieldVisitFilterDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID('all', { message: 'storeId debe ser un UUID.' })
  storeId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID('all', { message: 'zoneId debe ser un UUID.' })
  zoneId?: string;

  @ApiPropertyOptional({ example: '2026-11-01' }) @IsOptional() @Matches(FECHA, { message: 'dateFrom debe ser YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-11-30' }) @IsOptional() @Matches(FECHA, { message: 'dateTo debe ser YYYY-MM-DD' })
  dateTo?: string;
}
