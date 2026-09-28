import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { AccionAuditoria } from '../../entities/auditoria.entity';

const ACCIONES: AccionAuditoria[] = ['insert', 'update', 'delete', 'login', 'importacion'];

/**
 * M15 — Filtros de `GET /auditoria`. Todos opcionales: sin filtros trae
 * la bitácora completa paginada. `dateTo` es inclusivo (día completo).
 */
export class AuditFilterDto {
  @ApiPropertyOptional({ description: 'Solo eventos sobre esta tabla.' })
  @IsOptional()
  @IsString()
  tabla?: string;

  @ApiPropertyOptional({ description: 'Solo eventos sobre este registro.' })
  @IsOptional()
  @IsString()
  registroId?: string;

  @ApiPropertyOptional({ description: 'Solo eventos de este usuario.' })
  @IsOptional()
  @IsUUID('4', { message: 'usuarioId debe ser un UUID válido.' })
  usuarioId?: string;

  @ApiPropertyOptional({ enum: ACCIONES })
  @IsOptional()
  @IsIn(ACCIONES, { message: 'accion debe ser insert, update, delete, login o importacion.' })
  accion?: AccionAuditoria;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString({}, { message: 'dateFrom debe ser una fecha ISO válida.' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString({}, { message: 'dateTo debe ser una fecha ISO válida.' })
  dateTo?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
