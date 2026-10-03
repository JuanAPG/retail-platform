import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsDateString, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/** Filtros de `GET /v1/notifications`. `userId` solo Admin/Auditor. */
export class NotificationFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Ver las de otro usuario (solo Admin/Auditor).' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional({ description: 'Incluir archivadas ("true"/"false").' })
  @IsOptional()
  @IsBooleanString()
  archived?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString({}, { message: 'dateFrom debe ser una fecha ISO válida.' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString({}, { message: 'dateTo debe ser una fecha ISO válida.' })
  dateTo?: string;
}
