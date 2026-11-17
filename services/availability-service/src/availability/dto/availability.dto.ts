import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PaginaDto } from '../../common/dto/pagina.dto';

export const ORIGENES = ['movil', 'escritorio', 'web'] as const;
export type OrigenCaptura = (typeof ORIGENES)[number];

/** Tope de `numeric(12,2)`. */
const STOCK_MAXIMO = 9_999_999_999.99;

/** Levantamiento de la existencia de una presentación en una tienda. */
export class CreateCaptureDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Id generado en el dispositivo (D-42): reenviar la misma captura no la duplica. Si falta, lo genera el servidor.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'captureId debe ser un UUID.' })
  captureId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'storeId debe ser un UUID.' })
  storeId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'presentationId debe ser un UUID.' })
  presentationId: string;

  @ApiProperty({ example: 12, description: 'Existencia vista, ≥ 0. 0 = agotado.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'stock debe ser numérico, con 2 decimales como máximo.' })
  @Min(0, { message: 'stock no puede ser negativo.' })
  @Max(STOCK_MAXIMO)
  stock: number;

  @ApiPropertyOptional({
    example: '2026-10-26T15:30:00.000Z',
    description: 'Cuándo se VIO el dato (no cuándo se sube). Por defecto, ahora. No puede ser futuro.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'capturedAt debe ser una fecha y hora ISO 8601.' })
  capturedAt?: string;

  @ApiPropertyOptional({ enum: ORIGENES, default: 'web' })
  @IsOptional()
  @IsIn(ORIGENES, { message: 'origin debe ser movil, escritorio o web.' })
  origin?: OrigenCaptura;
}

export class CaptureFilterDto extends PaginaDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'storeId debe ser un UUID.' })
  storeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'presentationId debe ser un UUID.' })
  presentationId?: string;

  @ApiPropertyOptional({ enum: ['aceptada', 'conflicto'] })
  @IsOptional()
  @IsIn(['aceptada', 'conflicto'], { message: 'status debe ser aceptada o conflicto.' })
  status?: 'aceptada' | 'conflicto';
}

export class StockFilterDto extends PaginaDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'storeId debe ser un UUID.' })
  storeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'presentationId debe ser un UUID.' })
  presentationId?: string;

  @ApiPropertyOptional({ enum: ['disponible', 'agotado', 'vencido'] })
  @IsOptional()
  @IsIn(['disponible', 'agotado', 'vencido'], { message: 'status debe ser disponible, agotado o vencido.' })
  status?: 'disponible' | 'agotado' | 'vencido';
}

/** `GET /v1/availability/shortages`: exactamente uno de los dos. */
export class ShortageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'storeId debe ser un UUID.' })
  storeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'zoneId debe ser un UUID.' })
  zoneId?: string;
}
