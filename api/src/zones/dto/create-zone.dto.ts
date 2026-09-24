import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * M03 — Alta de zona. Solo la IDENTIDAD de la zona vive aquí: nombre,
 * municipio y descripción. La clasificación por segmento de ingreso y
 * los indicadores (ingreso estimado, población, disponibilidad) NO son
 * columnas de la zona — cambian con el tiempo y viven en tablas de
 * historial (`zona_clasificaciones`, `indicador_valores`) que llena el
 * módulo de Analítica cuando corre un cálculo.
 */
export class CreateZoneDto {
  @ApiProperty({ example: 'Zona Norte' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la zona es obligatorio.' })
  @MaxLength(120)
  nombre: string;

  @ApiProperty({ description: 'Id de un municipio existente.' })
  @Type(() => Number)
  @IsInt({ message: 'Selecciona un municipio válido.' })
  @IsPositive()
  municipioId: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;
}
