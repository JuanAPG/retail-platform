import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { AccionAuditoria } from '../../entities/auditoria.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ACCIONES } from './registrar-evento.dto';
import { SERVICIOS } from '../../common/servicios';

/**
 * Filtros de `GET /v1/auditoria`. Todos opcionales: sin filtros trae
 * la bitácora completa paginada. `dateTo` es inclusivo (día completo).
 * La paginación (`page`, `limit`) viene del DTO transversal.
 */
export class AuditFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Solo eventos sobre esta tabla.' })
  @IsOptional()
  @IsString()
  tabla?: string;

  @ApiPropertyOptional({ description: 'Solo eventos sobre este registro.' })
  @IsOptional()
  @IsString()
  registroId?: string;

  @ApiPropertyOptional({ description: 'Solo eventos reportados por este microservicio.', enum: SERVICIOS })
  @IsOptional()
  @IsIn(SERVICIOS, { message: `servicio debe ser uno de los 10 microservicios: ${SERVICIOS.join(', ')}.` })
  servicio?: string;

  @ApiPropertyOptional({ description: 'Solo eventos de este usuario.' })
  @IsOptional()
  @IsUUID('4', { message: 'usuarioId debe ser un UUID válido.' })
  usuarioId?: string;

  @ApiPropertyOptional({ enum: ACCIONES })
  @IsOptional()
  @IsIn(ACCIONES, { message: `accion debe ser una de: ${ACCIONES.join(', ')}.` })
  accion?: AccionAuditoria;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString({}, { message: 'dateFrom debe ser una fecha ISO válida.' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString({}, { message: 'dateTo debe ser una fecha ISO válida.' })
  dateTo?: string;
}
