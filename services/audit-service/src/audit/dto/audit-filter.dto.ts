import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AccionAuditoria } from '../../entities/auditoria.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ACCIONES } from './registrar-evento.dto';
import { SERVICIOS } from '../../common/servicios';

/** Solo día, sin hora: `2026-09-30`. */
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Filtros de `GET /v1/auditoria`. Todos opcionales: sin filtros trae
 * la bitácora completa paginada. La paginación (`page`, `limit`) viene
 * del DTO transversal.
 *
 * `dateFrom` y `dateTo` son DÍAS COMPLETOS e inclusivos, y por eso se
 * admite solo `YYYY-MM-DD`: `@IsDateString()` aceptaba también
 * `2026-10-10T15:00:00Z`, y entonces los dos extremos se comportaban
 * distinto — `dateFrom` respetaba la hora (comparación cruda contra un
 * TIMESTAMPTZ) mientras `dateTo` la tiraba al hacer CAST a date e
 * incluía el día entero. Un rango que el cliente creía de horas salía
 * de días. Si alguna vez se quiere filtrar por instante, es otro
 * parámetro y otro acuerdo de contrato, no el mismo con dos
 * significados.
 */
export class AuditFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Solo eventos sobre esta tabla.' })
  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'tabla no puede tener más de 80 caracteres.' })
  tabla?: string;

  @ApiPropertyOptional({ description: 'Solo eventos sobre este registro.' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'registroId no puede tener más de 200 caracteres.' })
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

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Día completo, inclusivo (UTC).' })
  @IsOptional()
  @Matches(SOLO_FECHA, { message: 'dateFrom debe ser una fecha YYYY-MM-DD (día completo, sin hora).' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Día completo, inclusivo (UTC).' })
  @IsOptional()
  @Matches(SOLO_FECHA, { message: 'dateTo debe ser una fecha YYYY-MM-DD (día completo, sin hora).' })
  dateTo?: string;
}
