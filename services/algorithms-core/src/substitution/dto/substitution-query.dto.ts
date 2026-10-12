import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsInt, Min } from 'class-validator';

/** M11 — Query de GET /v1/substitution/patterns. */
export class SubstitutionQueryDto {
  @ApiProperty({ example: 2, description: 'Categoría a analizar (solo la categoría directa, sin subcategorías).' })
  @IsDefined({ message: 'categoryId es obligatorio.' })
  // Los query params llegan como texto; sin @Type la validación falla.
  @Type(() => Number)
  @IsInt({ message: 'categoryId debe ser un número entero.' })
  @Min(1, { message: 'categoryId debe ser mayor a 0.' })
  categoryId: number;
}
