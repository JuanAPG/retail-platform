import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** M07 — Ámbito de la reclasificación de canastas sin segmento. */
export class ReclassifyBasketsDto {
  @ApiPropertyOptional({
    description: 'Limita la operación a una zona. Sin esto, abarca todas las canastas sin segmento.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'zoneId debe ser un UUID válido.' })
  zoneId?: string;
}
