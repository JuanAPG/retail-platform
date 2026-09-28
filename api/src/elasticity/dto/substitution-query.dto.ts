import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, Matches } from 'class-validator';

/**
 * M11 — Query de GET /substitution/patterns. El contrato recibe
 * `categoryId: string`, pero en la base es un número: se valida que sean
 * dígitos para responder 400 y no un error de base.
 */
export class SubstitutionQueryDto {
  @ApiProperty({ example: '2', description: 'Id de la categoría de productos.' })
  @IsDefined({ message: 'categoryId es obligatorio.' })
  @Matches(/^\d+$/, { message: 'categoryId debe ser un número entero positivo.' })
  categoryId: string;
}
