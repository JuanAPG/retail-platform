import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { BUSQUEDA_MAXIMA } from '../../common/helpers/busqueda.helper';
import { FORMATOS_TIENDA } from './create-store.dto';

/** Query de `GET /v1/stores`: paginación, búsqueda por texto y filtros (T-21). Se combinan con AND. */
export class StoreFilterDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'valle', description: 'Texto a buscar en nombre o número de sucursal.' })
  @IsOptional()
  @IsString()
  @MaxLength(BUSQUEDA_MAXIMA)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Solo las tiendas de esta zona.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'zonaId debe ser un UUID.' })
  zonaId?: string;

  @ApiPropertyOptional({ enum: FORMATOS_TIENDA })
  @IsOptional()
  @IsIn(FORMATOS_TIENDA, { message: `formato debe ser uno de: ${FORMATOS_TIENDA.join(', ')}` })
  formato?: (typeof FORMATOS_TIENDA)[number];
}
