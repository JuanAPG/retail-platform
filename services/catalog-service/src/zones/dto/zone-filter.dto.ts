import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ABooleano, BUSQUEDA_MAXIMA } from '../../common/helpers/busqueda.helper';

/** Query de `GET /v1/zones`: paginación, búsqueda por texto y filtros (T-21). Se combinan con AND. */
export class ZoneFilterDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'centro', description: 'Texto a buscar en nombre o descripción.' })
  @IsOptional()
  @IsString()
  @MaxLength(BUSQUEDA_MAXIMA)
  search?: string;

  @ApiPropertyOptional({ example: 2, description: 'Solo las zonas de este municipio.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'municipioId debe ser un número entero.' })
  @Min(1)
  @Max(32767)
  municipioId?: number;

  @ApiPropertyOptional({ description: '`true` = solo activas; `false` = solo desactivadas. Sin él, todas.' })
  @IsOptional()
  @ABooleano()
  @IsBoolean({ message: 'activo debe ser true o false.' })
  activo?: boolean;
}
