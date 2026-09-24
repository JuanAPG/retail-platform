import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/**
 * Edición de un producto ya existente. NO incluye `estatus`: ese campo
 * solo cambia a través del flujo de aprobación/rechazo
 * (`/productos/:id/aprobar` y `/rechazar`), para no abrir un atajo que
 * lo modifique sin dejar el registro en `producto_revisiones`.
 */
export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  categoriaId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  esCanastaBasica?: boolean;
}
