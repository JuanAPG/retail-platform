import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ABooleano, BUSQUEDA_MAXIMA } from '../../common/helpers/busqueda.helper';
import { ProductFilterDto } from './product-filter.dto';

export const ESTATUS_FILTRABLES = ['activo', 'pendiente_aprobacion', 'rechazado', 'inactivo'] as const;

/**
 * Query de `GET /v1/products`: paginación, búsqueda por texto y filtros (T-21) y, para quien
 * revisa, filtro por estatus (p. ej. los rechazados). Todos se combinan con AND.
 */
export class ProductListFilterDto extends ProductFilterDto {
  @ApiPropertyOptional({
    enum: ESTATUS_FILTRABLES,
    description: 'Solo Gerente de categoría, Administrador y Auditor. Sin él, la lista trae únicamente los activos.',
  })
  @IsOptional()
  @IsIn(ESTATUS_FILTRABLES)
  estatus?: (typeof ESTATUS_FILTRABLES)[number];

  @ApiPropertyOptional({ example: 'arroz', description: 'Texto a buscar en nombre, SKU o descripción (sin distinguir mayúsculas).' })
  @IsOptional()
  @IsString()
  @MaxLength(BUSQUEDA_MAXIMA)
  search?: string;

  @ApiPropertyOptional({ example: 1, description: 'Solo los productos de esta categoría.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'categoriaId debe ser un número entero.' })
  @Min(1)
  @Max(32767)
  categoriaId?: number;

  @ApiPropertyOptional({ description: '`true` = solo canasta básica (D-03); `false` = solo los que no lo son.' })
  @IsOptional()
  @ABooleano()
  @IsBoolean({ message: 'esCanastaBasica debe ser true o false.' })
  esCanastaBasica?: boolean;
}
