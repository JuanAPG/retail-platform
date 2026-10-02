import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class RecommendationContextDto {
  @ApiPropertyOptional({
    description: 'UUID de zona para acotar las reglas de accesibilidad/elasticidad/simulación; si se omite, evalúa todas las zonas con datos. La regla de asociación (M10) nunca se acota por zona: esas reglas no son por zona.',
  })
  @IsOptional()
  @IsUUID()
  zoneId?: string;
}
