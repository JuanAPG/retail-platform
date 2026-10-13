import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RECOMMENDATION_STATUSES, RecommendationStatus } from '../../entities/recommendation.entity';

export class RecommendationContextDto {
  @ApiPropertyOptional({
    description: 'UUID de zona para acotar las reglas de accesibilidad/elasticidad/simulación; si se omite, evalúa todas las zonas con datos. La regla de asociación (M10) nunca se acota por zona: esas reglas no son por zona.',
  })
  @IsOptional()
  @IsUUID()
  zoneId?: string;
}

/** Query de `GET /v1/recommendations`: paginación estándar + filtros opcionales. */
export class RecommendationQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'UUID de zona.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'zoneId debe ser un UUID válido.' })
  zoneId?: string;

  @ApiPropertyOptional({ enum: RECOMMENDATION_STATUSES })
  @IsOptional()
  @IsIn(RECOMMENDATION_STATUSES, { message: `status debe ser uno de: ${RECOMMENDATION_STATUSES.join(', ')}.` })
  status?: RecommendationStatus;
}

/** Body de `PATCH /v1/recommendations/:id/reject`. */
export class RejectRecommendationDto {
  /** Obligatorio: queda en la bitácora como la razón del Gerente (D-12). */
  @ApiProperty({ example: 'El ajuste de precio no aplica en temporada escolar.', minLength: 10, maxLength: 500 })
  @IsString({ message: 'motivo es obligatorio.' })
  @MinLength(10, { message: 'Explica el motivo del rechazo (mínimo 10 caracteres).' })
  @MaxLength(500, { message: 'motivo no puede pasar de 500 caracteres.' })
  motivo: string;
}
