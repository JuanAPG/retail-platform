import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * M06 — Filtros de consulta de transacciones. Todos opcionales y
 * combinables (AND). Hereda `?page&limit` del estándar de paginación.
 */
export class TransactionFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Solo transacciones de esta tienda.' })
  @IsOptional()
  @IsUUID('4', { message: 'storeId debe ser un UUID válido.' })
  storeId?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Desde esta fecha, inclusive.' })
  @IsOptional()
  @IsDateString({}, { message: 'dateFrom debe ser una fecha ISO válida.' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Hasta esta fecha, inclusive (día completo).' })
  @IsOptional()
  @IsDateString({}, { message: 'dateTo debe ser una fecha ISO válida.' })
  dateTo?: string;
}
