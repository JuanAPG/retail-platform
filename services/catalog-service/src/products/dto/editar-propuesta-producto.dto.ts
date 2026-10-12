import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/**
 * CAT-14 / D-11 — Lo que un Proveedor puede corregir de SU propuesta mientras sigue pendiente:
 * nombre, descripción, categoría y la presentación que propuso. Igual que al proponer, NO incluye
 * `sku`, `proveedorId`, `estatus` ni `esCanastaBasica` (el ValidationPipe rechaza lo que sobre).
 * Todos los campos son opcionales: se edita solo lo que viene.
 */
export class EditarPropuestaProductoDto {
  @ApiPropertyOptional({ example: 'Quinoa orgánica 500 g' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El nombre del producto no puede ir vacío.' })
  @MaxLength(150)
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Selecciona una categoría válida.' })
  @IsPositive()
  categoriaId?: number;

  @ApiPropertyOptional({ example: '500 g', description: 'Nombre de la presentación propuesta.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la presentación no puede ir vacío.' })
  @MaxLength(60)
  presentacion?: string;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'El contenido debe ser un número.' })
  @IsPositive({ message: 'El contenido debe ser mayor que cero.' })
  contenido?: number;

  @ApiPropertyOptional({ example: 'g' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  unidadMedida?: string;
}
