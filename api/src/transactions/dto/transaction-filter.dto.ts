import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/** M06 — Filtros de consulta de transacciones. Todos opcionales. */
export class TransactionFilterDto {
  @ApiPropertyOptional({ description: 'Solo transacciones de esta tienda.' })
  @IsOptional()
  @IsUUID('4', { message: 'storeId debe ser un UUID válido.' })
  storeId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString({}, { message: 'dateFrom debe ser una fecha ISO válida.' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString({}, { message: 'dateTo debe ser una fecha ISO válida.' })
  dateTo?: string;
}
