import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsPositive, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * CAT-13 — Carga manual de los indicadores de una zona: ingreso estimado, población y disponibilidad.
 * Son los que `GET /v1/zones/compare` y la accesibilidad leen; sin ellos salían `null` / 0.
 * No son columnas de la zona: cambian con el tiempo y se guardan como historial (`indicador_valores`).
 */
export class ZoneIndicatorsDto {
  @ApiProperty({ example: 18500, description: 'Ingreso mensual estimado del hogar promedio de la zona (MXN), mayor o igual a 0.' })
  @Type(() => Number)
  @IsNumber({}, { message: 'ingresoEstimado debe ser numérico.' })
  @Min(0, { message: 'ingresoEstimado no puede ser negativo.' })
  ingresoEstimado: number;

  @ApiProperty({ example: 42000, description: 'Habitantes estimados de la zona, mayor o igual a 0.' })
  @Type(() => Number)
  @IsNumber({}, { message: 'poblacion debe ser numérico.' })
  @Min(0, { message: 'poblacion no puede ser negativa.' })
  poblacion: number;

  @ApiProperty({ example: 0.85, description: 'Proporción de productos básicos con stock en la zona, entre 0 y 1.' })
  @Type(() => Number)
  @IsNumber({}, { message: 'disponibilidad debe ser numérico.' })
  @Min(0, { message: 'disponibilidad debe estar entre 0 y 1.' })
  @Max(1, { message: 'disponibilidad debe estar entre 0 y 1.' })
  disponibilidad: number;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(FECHA, { message: 'periodoInicio debe ser YYYY-MM-DD.' })
  periodoInicio: string;

  @ApiProperty({ example: '2026-09-30' })
  @Matches(FECHA, { message: 'periodoFin debe ser YYYY-MM-DD.' })
  periodoFin: string;

  @ApiProperty({ example: 'INEGI - Censo 2020', description: 'De dónde salen los datos (trazabilidad).' })
  @IsString()
  @IsNotEmpty({ message: 'La fuente es obligatoria.' })
  @MaxLength(200)
  fuente: string;
}

/** CAT-13 — Clasificación manual de una zona en un segmento de ingreso. */
export class ZoneClassificationDto {
  @ApiProperty({ example: 2, description: 'Id de un segmento de ingreso existente.' })
  @Type(() => Number)
  @IsInt({ message: 'segmentId debe ser un entero.' })
  @IsPositive()
  segmentId: number;
}
