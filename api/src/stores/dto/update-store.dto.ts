import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateStoreDto } from './create-store.dto';

/**
 * `PartialType` toma el DTO de alta y hace TODOS sus campos opcionales:
 * así una edición puede mandar solo lo que cambió (por ejemplo, solo el
 * `nombre`) sin tener que repetir la tienda completa.
 */
export class UpdateStoreDto extends PartialType(CreateStoreDto) {
  @ApiPropertyOptional({ description: 'Activa o desactiva la tienda sin borrarla.' })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
