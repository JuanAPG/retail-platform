import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { PaginaDto } from '../../common/dto/pagina.dto';

/** Tope de `segmentos_ingreso.id` (SMALLSERIAL). */
const SEGMENTO_MAXIMO = 32767;

export class ClassifyZoneDto {
  @ApiProperty({ example: 2, description: 'Segmento en el que queda la zona (se guarda su versión vigente).' })
  @Type(() => Number)
  @IsInt({ message: 'segmentId debe ser un número entero.' })
  @Min(1)
  @Max(SEGMENTO_MAXIMO)
  segmentId: number;
}

export class ClassificationFilterDto extends PaginaDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'zoneId debe ser un UUID.' })
  zoneId?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'segmentId debe ser un número entero.' })
  @Min(1)
  @Max(SEGMENTO_MAXIMO)
  segmentId?: number;

  @ApiPropertyOptional({ description: '`true` = solo vigentes; `false` = solo cerradas.' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'current debe ser true o false.' })
  current?: boolean;

  @ApiPropertyOptional({ example: '2026-08-15', description: 'Las que valían ese día. No se combina con `current`.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'asOf debe tener el formato YYYY-MM-DD.' })
  asOf?: string;
}
