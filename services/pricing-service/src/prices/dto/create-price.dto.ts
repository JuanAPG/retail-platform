import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsPositive, IsUUID, Max } from 'class-validator';
import { IsFechaIso } from '../../common/validators/fecha-calendario';
import { PRECIO_MAXIMO } from '../../common/precio';

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
  @Max(PRECIO_MAXIMO, { message: `price no puede pasar de ${PRECIO_MAXIMO}.` })
  price: number;

  @ApiPropertyOptional({
    example: '2026-09-14',
    description: 'Fecha desde la que aplica (YYYY-MM-DD). Por omisión, hoy.',
  })
  @IsOptional()
  @IsFechaIso({ message: 'effectiveDate debe ser una fecha válida (YYYY-MM-DD).' })
  effectiveDate?: string;
}
