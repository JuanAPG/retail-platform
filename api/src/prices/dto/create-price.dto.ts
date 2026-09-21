import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';

/**
 * M08 — Registrar un precio (PriceHistory).
 *
 * El Contrato_Metodos_Endpoints describe la entidad con `productId` y
 * `zoneId`, pero en el esquema (RN-06) el precio cuelga de PRESENTACIÓN
 * + TIENDA, no de producto ni de zona directamente: dos presentaciones
 * del mismo producto valen distinto, y la zona se deriva de
 * `tienda.zona_id`. Por eso este DTO pide `presentationId` +
 * `storeId` en vez de `productId` + `zoneId`.
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
    description: 'Fecha desde la que aplica. Por omisión, hoy.',
  })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}
