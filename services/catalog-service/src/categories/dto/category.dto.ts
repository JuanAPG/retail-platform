import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ABooleano } from '../../common/helpers/busqueda.helper';

/** Tope de `categorias_producto.id` (SMALLSERIAL). */
const ID_MAXIMO = 32767;

/** Alta de una categoría de producto (T-21). Nace activa. */
export class CreateCategoryDto {
  @ApiProperty({ example: 'Lácteos' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(80)
  nombre: string;

  @ApiPropertyOptional({ example: 1, description: 'Categoría de la que es subcategoría. Omitir = categoría raíz.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'categoriaPadreId debe ser un número entero.' })
  @Min(1)
  @Max(ID_MAXIMO)
  categoriaPadreId?: number | null;

  @ApiPropertyOptional({ example: 'Leche, queso, yogur y derivados.' })
  @IsOptional()
  @IsString()
  descripcion?: string | null;
}

/** Edición: todos opcionales. `activo: true` reactiva una categoría desactivada. */
export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Lácteos y huevo' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El nombre no puede quedar vacío.' })
  @MaxLength(80)
  nombre?: string;

  @ApiPropertyOptional({ example: 1, description: '`null` la vuelve categoría raíz.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'categoriaPadreId debe ser un número entero.' })
  @Min(1)
  @Max(ID_MAXIMO)
  categoriaPadreId?: number | null;

  @ApiPropertyOptional({ description: '`null` borra la descripción.' })
  @IsOptional()
  @IsString()
  descripcion?: string | null;

  @ApiPropertyOptional({ description: 'Desactiva (`false`) o reactiva (`true`) sin borrar.' })
  @IsOptional()
  @IsBoolean({ message: 'activo debe ser true o false.' })
  activo?: boolean;
}

/** Query de `GET /v1/product-categories`. */
export class CategoryQueryDto {
  @ApiPropertyOptional({ description: '`true` incluye también las desactivadas (para administrarlas). Por omisión, solo las activas.' })
  @IsOptional()
  @ABooleano()
  @IsBoolean({ message: 'includeInactive debe ser true o false.' })
  includeInactive?: boolean;
}
