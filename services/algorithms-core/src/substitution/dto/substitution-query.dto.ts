import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsOptional, Min } from 'class-validator';
import { LIMITE_DEFAULT, LIMITE_MAXIMO } from '../../common/dto/pagination.dto';

/** M11 — Query de GET /v1/substitution/patterns. */
export class SubstitutionQueryDto {
  @ApiProperty({ example: 2, description: 'Categoría a analizar (solo la categoría directa, sin subcategorías).' })
  @IsDefined({ message: 'categoryId es obligatorio.' })
  // Los query params llegan como texto; sin @Type la validación falla.
  @Type(() => Number)
  @IsInt({ message: 'categoryId debe ser un número entero.' })
  @Min(1, { message: 'categoryId debe ser mayor a 0.' })
  categoryId: number;

  /**
   * Tope propio (top-N) que pide la excepción de `paginacion.md` para los
   * cálculos al vuelo: misma regla que `limit` en la paginación estándar.
   */
  @ApiPropertyOptional({
    default: LIMITE_DEFAULT,
    description: `Cuántos pares devolver, los de mayor score (mayor a ${LIMITE_MAXIMO} se recorta a ${LIMITE_MAXIMO}).`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un número entero.' })
  @Min(1, { message: 'limit debe ser mayor a 0.' })
  limit?: number;
}
