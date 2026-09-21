import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * M05 — Alta de un segmento de ingreso (IncomeSegment).
 *
 * `source`, `updateFrequency`, `zoneRelation` y `limitations` son
 * obligatorios a propósito: la retroalimentación del profesor exige que
 * cada segmento justifique de dónde sale el rango, cada cuánto se
 * actualiza, cómo se relaciona con la zona y qué limitaciones tiene —
 * no basta con declarar el rango numérico.
 */
export class CreateSegmentDto {
  @ApiProperty({ example: 'ING_1', description: 'Código corto y único del segmento.' })
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
  @IsNumber({}, { message: 'incomeRangeMin debe ser numérico.' })
  incomeRangeMin: number;

  @ApiPropertyOptional({ example: 15000, description: 'Vacío = sin tope superior.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'incomeRangeMax debe ser numérico.' })
  @IsPositive()
  incomeRangeMax?: number;

  @ApiProperty({
    example: 'INEGI - ENIGH, ingreso corriente trimestral por hogar (AMM)',
    description: 'De dónde sale el rango de ingreso.',
  })
  @IsString()
  @IsNotEmpty({ message: 'La fuente es obligatoria.' })
  source: string;

  @ApiProperty({ example: 'Anual, al publicarse la ENIGH' })
  @IsString()
  @IsNotEmpty({ message: 'La frecuencia de actualización es obligatoria.' })
  @MaxLength(60)
  updateFrequency: string;

  @ApiProperty({
    example: 'Se asigna a la ZONA agregada (RN-02); nunca a una persona ni compra individual.',
  })
  @IsString()
  @IsNotEmpty({ message: 'La relación con zona es obligatoria.' })
  zoneRelation: string;

  @ApiProperty({
    example: 'No captura variación de ingreso dentro de la misma zona.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Las limitaciones son obligatorias.' })
  limitations: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
