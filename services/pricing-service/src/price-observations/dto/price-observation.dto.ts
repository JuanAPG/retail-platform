import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, Max, MaxLength, MinLength, Min } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * PRI-09 / D-16 — Un precio levantado EN TIENDA desde la app móvil. Nace pendiente, igual que una propuesta de
 * proveedor, y no cambia el precio actual hasta que el Responsable de precios lo aprueba.
 *
 * Deliberadamente NO incluye `capturadoPor`, `estatus` ni `origen`: los fija el servidor (el usuario del token y
 * `pendiente`). El `ValidationPipe` global rechaza lo que sobre.
 */
export class CreatePriceObservationDto {
  @ApiProperty({ description: 'Id de la presentación observada.' })
  @IsUUID()
  @IsNotEmpty({ message: 'presentationId es obligatorio.' })
  presentationId: string;

  @ApiProperty({ description: 'Id de la tienda donde se levantó el precio.' })
  @IsUUID()
  @IsNotEmpty({ message: 'storeId es obligatorio.' })
  storeId: string;

  @ApiProperty({ example: 27.5, description: 'Precio visto en el anaquel, mayor que 0 (máximo 2 decimales).' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'price debe ser numérico, con máximo 2 decimales.' })
  @IsPositive({ message: 'price debe ser mayor que cero.' })
  price: number;

  @ApiPropertyOptional({ example: '2026-10-08T15:30:00Z', description: 'Cuándo se observó (ISO 8601). Por omisión, ahora. No puede ser futuro.' })
  @IsOptional()
  @IsDateString()
  observedAt?: string;

  @ApiPropertyOptional({ example: 25.6866, description: 'Latitud GPS del levantamiento, entre -90 y 90.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'lat debe ser numérico.' })
  @Min(-90, { message: 'lat debe estar entre -90 y 90.' })
  @Max(90, { message: 'lat debe estar entre -90 y 90.' })
  lat?: number;

  @ApiPropertyOptional({ example: -100.3161, description: 'Longitud GPS del levantamiento, entre -180 y 180.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'lng debe ser numérico.' })
  @Min(-180, { message: 'lng debe estar entre -180 y 180.' })
  @Max(180, { message: 'lng debe estar entre -180 y 180.' })
  lng?: number;
}

export class PriceObservationQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['pendiente', 'aprobado', 'rechazado'] })
  @IsOptional()
  @IsIn(['pendiente', 'aprobado', 'rechazado'], { message: 'status debe ser pendiente, aprobado o rechazado.' })
  status?: string;
}

export class ApprovePriceObservationDto {
  @ApiPropertyOptional({ example: '2026-10-08', description: 'Desde cuándo rige el precio aprobado (YYYY-MM-DD). Por omisión, hoy.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'effectiveDate debe ser YYYY-MM-DD.' })
  effectiveDate?: string;
}

export class RejectPriceObservationDto {
  @ApiProperty({ example: 'La foto del anaquel no coincide con el precio.', description: 'Motivo del rechazo (10 a 500 caracteres).' })
  @IsString()
  @MinLength(10, { message: 'rejectionReason debe tener al menos 10 caracteres.' })
  @MaxLength(500)
  rejectionReason: string;
}
