import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Alta DIRECTA de un producto por Administrador/Gerente de categoría —
 * distinta de `CrearPropuestaProductoDto` (esa es del Proveedor, nace
 * pendiente de aprobación). Aquí sí se puede marcar `esCanastaBasica`
 * porque es justo la clasificación de negocio que le corresponde al
 * Gerente decidir (RN-04), no algo que el Proveedor propone.
 */
export class CreateProductDto {
  @ApiProperty({ example: 'ABA-ARR-001' })
  @IsString()
  @IsNotEmpty({ message: 'El SKU es obligatorio.' })
  @MaxLength(40)
  sku: string;

  @ApiProperty({ example: 'Arroz blanco 1 kg' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del producto es obligatorio.' })
  @MaxLength(150)
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiProperty({ example: 1, description: 'Id de una categoría existente.' })
  @Type(() => Number)
  @IsInt({ message: 'Selecciona una categoría válida.' })
  @IsPositive()
  categoriaId: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  esCanastaBasica?: boolean;

  // --- Primera presentación (se crea junto con el producto, RF-35) ---

  @ApiProperty({ example: '1 kg' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la presentación es obligatorio.' })
  @MaxLength(60)
  presentacion: string;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsNumber({}, { message: 'El contenido debe ser un número.' })
  @IsPositive({ message: 'El contenido debe ser mayor que cero.' })
  contenido: number;

  @ApiProperty({ example: 'kg', description: "Clave del catálogo: 'kg','g','l','ml','pza'." })
  @IsString()
  @IsNotEmpty({ message: 'La unidad de medida es obligatoria.' })
  @MaxLength(10)
  unidadMedida: string;
}
