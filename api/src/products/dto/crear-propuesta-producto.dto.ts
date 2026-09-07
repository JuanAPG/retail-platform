import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, IsPositive, IsNumber } from 'class-validator';

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
 *
 * Sí incluye la PRIMERA presentación (RF-35): un producto sin
 * presentación no se puede cotizar ni vender, así que se crean juntos.
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

  @ApiProperty({ example: '500 g', description: 'Nombre de la presentación.' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la presentación es obligatorio.' })
  @MaxLength(60)
  presentacion: string;

  @ApiProperty({ example: 500, description: 'Contenido de la presentación.' })
  @Type(() => Number)
  @IsNumber({}, { message: 'El contenido debe ser un número.' })
  @IsPositive({ message: 'El contenido debe ser mayor que cero.' })
  contenido: number;

  @ApiProperty({ example: 'g', description: "Clave del catálogo: 'kg','g','l','ml','pza'." })
  @IsString()
  @IsNotEmpty({ message: 'La unidad de medida es obligatoria.' })
  @MaxLength(10)
  unidadMedida: string;
}
