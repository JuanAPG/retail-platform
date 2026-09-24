import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreatePresentationDto {
  @ApiProperty({ example: '500 g' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la presentación es obligatorio.' })
  @MaxLength(60)
  nombre: string;

  @ApiProperty({ example: 500 })
  @Type(() => Number)
  @IsNumber({}, { message: 'El contenido debe ser un número.' })
  @IsPositive({ message: 'El contenido debe ser mayor que cero.' })
  contenido: number;

  @ApiProperty({ example: 'g', description: "Clave del catálogo: 'kg','g','l','ml','pza'." })
  @IsString()
  @IsNotEmpty({ message: 'La unidad de medida es obligatoria.' })
  @MaxLength(10)
  unidadMedida: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  codigoBarras?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  esPredeterminada?: boolean;
}
