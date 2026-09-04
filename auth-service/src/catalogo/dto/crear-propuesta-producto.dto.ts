import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, IsPositive } from 'class-validator';

/**
 * Lo que un Proveedor puede proponer. Deliberadamente NO incluye:
 *
 * - `proveedorId`: se resuelve desde el token del solicitante. Si viniera
 *   en el cuerpo, un proveedor podría dar de alta productos a nombre de
 *   otro. El ValidationPipe global (forbidNonWhitelisted) rechaza la
 *   petición si intenta mandarlo.
 * - `estatus`: toda propuesta nace en 'pendiente_aprobacion'.
 * - `esCanastaBasica`: es una clasificación de negocio (RN-04) que le
 *   corresponde al Gerente de categoría, no a quien vende el producto.
 */
export class CrearPropuestaProductoDto {
  @ApiProperty({ example: 'BIO-QUI-500' })
  @IsString()
  @IsNotEmpty({ message: 'El SKU es obligatorio.' })
  @MaxLength(40)
  sku: string;

  @ApiProperty({ example: 'Quinoa orgánica 500 g' })
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

  @ApiProperty({ example: 'kg', description: "Ej. 'pieza', 'kg', 'litro'." })
  @IsString()
  @IsNotEmpty({ message: 'La unidad de medida es obligatoria.' })
  @MaxLength(20)
  unidadMedida: string;
}
