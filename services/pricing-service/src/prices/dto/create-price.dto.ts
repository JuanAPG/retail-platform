import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';

/**
 * Registrar un precio (RN-06). El precio cuelga de PRESENTACIÓN + TIENDA, no
 * de producto ni de zona: dos presentaciones del mismo producto valen
 * distinto, y la zona se deriva de `tiendas.zona_id`.
 *
 * Deliberadamente NO incluye `origen` ni `createdBy`: los fija el servidor
 * (`interno` y el usuario del token). El `ValidationPipe` global rechaza la
 * petición si se intentan mandar.
 */
export class CreatePriceDto {
  @ApiProperty({ description: 'Id de la presentación (producto_presentaciones.id).' })
  @IsUUID()
  @IsNotEmpty({ message: 'presentationId es obligatorio.' })
  presentationId: string;

  @ApiProperty({ description: 'Id de la tienda donde aplica este precio.' })
  @IsUUID()
  @IsNotEmpty({ message: 'storeId es obligatorio.' })
  storeId: string;

  @ApiProperty({ example: 42.5 })
  @Type(() => Number)
  @IsNumber({}, { message: 'price debe ser numérico.' })
  @IsPositive({ message: 'price debe ser mayor que cero.' })
  price: number;

  @ApiPropertyOptional({
    example: '2026-09-14',
    description: 'Fecha desde la que aplica (YYYY-MM-DD). Por omisión, hoy.',
  })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}
