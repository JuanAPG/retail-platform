import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ProductFilterDto } from './product-filter.dto';

export const ESTATUS_FILTRABLES = ['activo', 'pendiente_aprobacion', 'rechazado', 'inactivo'] as const;

/** Query de `GET /v1/products`: paginación y, para quien revisa, filtro por estatus (p. ej. los rechazados). */
export class ProductListFilterDto extends ProductFilterDto {
  @ApiPropertyOptional({
    enum: ESTATUS_FILTRABLES,
    description: 'Solo Gerente de categoría, Administrador y Auditor. Sin él, la lista trae únicamente los activos.',
  })
  @IsOptional()
  @IsIn(ESTATUS_FILTRABLES)
  estatus?: (typeof ESTATUS_FILTRABLES)[number];
}
