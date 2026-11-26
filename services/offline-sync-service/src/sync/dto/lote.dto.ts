import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ISO_CON_ZONA } from '../reglas';
import { CLIENTES, ESTADOS_CAPTURA, TIPOS_CAPTURA } from '../tipos';

/**
 * Estructura del lote (contrato §4.3). Si algo de aquí falla, el lote
 * COMPLETO responde 400: es lo mismo que exige el XSD, así JSON y XML se
 * rechazan igual. Las reglas de valor (stock ≥ 0, price > 0, versión de la
 * captura, futuro…) son por captura y van en `reglas.ts`.
 */

const VERSION = /^\d{1,3}\.\d{1,3}$/;
const NUMERO = { allowNaN: false, allowInfinity: false };
const MSJ_ZONA = 'debe ser ISO 8601 con segundos y zona horaria (Z o ±hh:mm)';

export class ContenidoDto {
  @ApiPropertyOptional({ description: 'disponibilidad: existencia en unidades de la presentación (≥ 0, 2 decimales).', example: 12 })
  @IsOptional()
  @IsNumber(NUMERO, { message: 'content.stock debe ser un número.' })
  stock?: number;

  @ApiPropertyOptional({ description: 'precio_observado: MXN por presentación (> 0, 2 decimales).', example: 27.5 })
  @IsOptional()
  @IsNumber(NUMERO, { message: 'content.price debe ser un número.' })
  price?: number;

  @ApiPropertyOptional({ description: 'precio_observado: latitud WGS84; va junto con lng.', example: 25.6866 })
  @IsOptional()
  @IsNumber(NUMERO, { message: 'content.lat debe ser un número.' })
  lat?: number;

  @ApiPropertyOptional({ description: 'precio_observado: longitud WGS84; va junto con lat.', example: -100.3161 })
  @IsOptional()
  @IsNumber(NUMERO, { message: 'content.lng debe ser un número.' })
  lng?: number;
}

export class CapturaDto {
  @ApiProperty({ description: 'UUID generado en el dispositivo; se conserva en cada reintento.' })
  @IsUUID('all', { message: 'captureId debe ser un UUID.' })
  captureId!: string;

  @ApiProperty({ enum: TIPOS_CAPTURA })
  @IsIn(TIPOS_CAPTURA, { message: `type debe ser uno de: ${TIPOS_CAPTURA.join(', ')}` })
  type!: (typeof TIPOS_CAPTURA)[number];

  @ApiProperty({ example: '1.0' })
  @Matches(VERSION, { message: 'contractVersion debe tener la forma mayor.menor (p. ej. 1.0).' })
  contractVersion!: string;

  @ApiProperty({ description: 'Cuándo se HIZO la captura, con zona horaria.', example: '2026-10-26T09:30:00-06:00' })
  @Matches(ISO_CON_ZONA, { message: `capturedAt ${MSJ_ZONA}` })
  capturedAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'storeId debe ser un UUID.' })
  storeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'presentationId debe ser un UUID.' })
  presentationId?: string;

  @ApiProperty({ type: ContenidoDto })
  @IsDefined({ message: 'content es obligatorio.' })
  @IsObject({ message: 'content debe ser un objeto.' })
  @ValidateNested()
  @Type(() => ContenidoDto)
  content!: ContenidoDto;
}

export class LoteSyncDto {
  @ApiProperty({ description: 'UUID del lote, generado en el dispositivo; estable al reintentar.' })
  @IsUUID('all', { message: 'batchId debe ser un UUID.' })
  batchId!: string;

  @ApiProperty({ description: 'UUID del dispositivo (se genera al instalar la app).' })
  @IsUUID('all', { message: 'deviceId debe ser un UUID.' })
  deviceId!: string;

  @ApiProperty({ example: '1.0' })
  @Matches(VERSION, { message: 'contractVersion debe tener la forma mayor.menor (p. ej. 1.0).' })
  contractVersion!: string;

  @ApiProperty({ enum: CLIENTES })
  @IsIn(CLIENTES, { message: `client debe ser uno de: ${CLIENTES.join(', ')}` })
  client!: (typeof CLIENTES)[number];

  @ApiPropertyOptional({ example: '2026-10-30T09:02:00-06:00' })
  @IsOptional()
  @Matches(ISO_CON_ZONA, { message: `sentAt ${MSJ_ZONA}` })
  sentAt?: string;

  @ApiProperty({ type: [CapturaDto], description: 'De 1 a 500 capturas (más → 413).' })
  @IsArray({ message: 'captures debe ser una lista.' })
  @ArrayMinSize(1, { message: 'captures debe traer al menos una captura.' })
  @ValidateNested({ each: true })
  @Type(() => CapturaDto)
  captures!: CapturaDto[];
}

export class FiltroLotesDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('all', { message: 'deviceId debe ser un UUID.' })
  deviceId?: string;

  @ApiPropertyOptional({ enum: ESTADOS_CAPTURA, description: 'Lotes con al menos una captura en ese estado.' })
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD, día local de America/Monterrey, inclusivo.' })
  @IsOptional()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD, día local de America/Monterrey, inclusivo.' })
  @IsOptional()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Solo Administrador y Auditor.' })
  @IsOptional()
  @IsUUID('all', { message: 'userId debe ser un UUID.' })
  userId?: string;
}
