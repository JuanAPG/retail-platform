import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';
import { PaginaDto } from '../../common/dto/pagina.dto';

/** Tope de `numeric(12,2)`: más que esto Postgres lo rechaza (saldría 500). */
const INGRESO_MAXIMO = 9_999_999_999.99;

/**
 * Alta de un segmento de ingreso (nace en su versión 1).
 *
 * `source`, `updateFrequency`, `zoneRelation` y `limitations` son obligatorios
 * a propósito: cada segmento justifica de dónde sale su rango, cada cuánto se
 * actualiza, cómo se relaciona con la ZONA agregada (RN-02) y qué limitaciones
 * tiene. No basta con decir "bajo, medio, alto".
 */
export class CreateSegmentDto {
  @ApiProperty({ example: 'ING_1', description: 'Código corto y único. No cambia entre versiones.' })
  @IsString()
  @IsNotEmpty({ message: 'El código es obligatorio.' })
  @MaxLength(20)
  code: string;

  @ApiProperty({ example: 'Ingreso bajo' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(60)
  name: string;

  @ApiProperty({ example: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'incomeRangeMin debe ser numérico, con 2 decimales como máximo.' })
  @Min(0, { message: 'incomeRangeMin no puede ser negativo.' })
  @Max(INGRESO_MAXIMO)
  incomeRangeMin: number;

  @ApiPropertyOptional({ example: 15000, description: 'Omitir = sin tope superior.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'incomeRangeMax debe ser numérico, con 2 decimales como máximo.' })
  @IsPositive({ message: 'incomeRangeMax debe ser mayor a 0.' })
  @Max(INGRESO_MAXIMO)
  incomeRangeMax?: number | null;

  @ApiProperty({
    example: 'INEGI - ENIGH, ingreso corriente trimestral por hogar (AMM)',
    description: 'De dónde sale el rango: institución, publicación o enlace.',
  })
  @IsString()
  @IsNotEmpty({ message: 'La fuente es obligatoria.' })
  source: string;

  @ApiProperty({ example: 'Anual, al publicarse la ENIGH' })
  @IsString()
  @IsNotEmpty({ message: 'La frecuencia de actualización es obligatoria.' })
  @MaxLength(60)
  updateFrequency: string;

  @ApiProperty({ example: 'Se asigna a la ZONA agregada (RN-02); nunca a una persona ni compra individual.' })
  @IsString()
  @IsNotEmpty({ message: 'La relación con la zona es obligatoria.' })
  zoneRelation: string;

  @ApiProperty({ example: 'No captura variación de ingreso dentro de la misma zona.' })
  @IsString()
  @IsNotEmpty({ message: 'Las limitaciones son obligatorias.' })
  limitations: string;

  @ApiPropertyOptional({ example: 'Opcional' })
  @IsOptional()
  @IsString()
  description?: string | null;
}

/**
 * Edición: crea una versión nueva (D-35). Todos los campos son opcionales y
 * NO existe `code` (mandarlo → 400 por campo desconocido): el código
 * identifica al segmento entre versiones.
 */
export class UpdateSegmentDto {
  @ApiPropertyOptional({ example: 'Ingreso bajo' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El nombre no puede quedar vacío.' })
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'incomeRangeMin debe ser numérico, con 2 decimales como máximo.' })
  @Min(0, { message: 'incomeRangeMin no puede ser negativo.' })
  @Max(INGRESO_MAXIMO)
  incomeRangeMin?: number;

  @ApiPropertyOptional({ example: 16000, description: '`null` quita el tope superior.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'incomeRangeMax debe ser numérico, con 2 decimales como máximo.' })
  @IsPositive({ message: 'incomeRangeMax debe ser mayor a 0.' })
  @Max(INGRESO_MAXIMO)
  incomeRangeMax?: number | null;

  @ApiPropertyOptional({ example: 'INEGI - ENIGH 2024' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'La fuente no puede quedar vacía.' })
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  updateFrequency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  zoneRelation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  limitations?: string;

  @ApiPropertyOptional({ description: '`null` borra la descripción.' })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ example: 'Se actualiza con la ENIGH 2024.', description: 'Por qué cambió (queda en la versión).' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  changeReason?: string;
}

/** Query de los listados de segmentos y de versiones: paginación estándar. */
export class SegmentFilterDto extends PaginaDto {}
