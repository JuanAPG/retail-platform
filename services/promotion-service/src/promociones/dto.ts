import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { TIPOS_PROMOCION, TipoPromocion } from './calculo';
import { EstatusPromocion } from './repositorio';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MENSAJE_FECHA = (campo: string) => `${campo} debe ser una fecha YYYY-MM-DD`;
export const ESTATUS: readonly EstatusPromocion[] = ['pendiente', 'aprobada', 'rechazada'];

/**
 * `POST /v1/promotions` (§6). El cuerpo NO acepta `proposedBy`, `resolvedBy`
 * ni `status` (salen del token y del flujo): el `ValidationPipe`
 * (`forbidNonWhitelisted`) los rechaza con 400 como cualquier campo no listado.
 *
 * Los números se exigen como números (en JSON, `"10"` es 400). En XML llegan
 * como texto y `CuerpoXmlInterceptor` los convierte antes de este DTO.
 * Qué campos exige o prohíbe cada `type` lo revisa el servicio (§4).
 */
export class CrearPromocionDto {
  @ApiProperty({ example: 'Arroz 1 kg con 10 % en Zona Centro', minLength: 3, maxLength: 120 })
  @IsString({ message: 'name debe ser texto' })
  @Length(3, 120, { message: 'name debe tener entre 3 y 120 caracteres' })
  name: string;

  @ApiProperty({ enum: TIPOS_PROMOCION })
  @IsIn(TIPOS_PROMOCION, { message: `type debe ser uno de: ${TIPOS_PROMOCION.join(', ')}` })
  type: TipoPromocion;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'productId debe ser un UUID' })
  productId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'presentationId debe ser un UUID' })
  presentationId: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Exactamente uno de storeId o zoneId (PROPUESTA).' })
  @IsOptional()
  @IsUUID('all', { message: 'storeId debe ser un UUID' })
  storeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'zoneId debe ser un UUID' })
  zoneId?: string;

  @ApiPropertyOptional({ description: 'Solo descuento_porcentual: 0 < x < 100, 2 decimales.', example: 10 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'discountPct debe ser numérico, con máximo 2 decimales' })
  @Min(0.01, { message: 'discountPct debe ser mayor a 0 y menor a 100' })
  @Max(99.99, { message: 'discountPct debe ser mayor a 0 y menor a 100' })
  discountPct?: number;

  @ApiPropertyOptional({ description: 'Solo paquete: entero de 2 a 99.', example: 3 })
  @IsOptional()
  @IsInt({ message: 'packQuantity debe ser un entero' })
  @Min(2, { message: 'packQuantity debe estar entre 2 y 99' })
  @Max(99, { message: 'packQuantity debe estar entre 2 y 99' })
  packQuantity?: number;

  @ApiPropertyOptional({ description: 'Solo paquete: MXN > 0, 2 decimales.', example: 80 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'packPrice debe ser numérico, con máximo 2 decimales' })
  @Min(0.01, { message: 'packPrice debe ser mayor a 0' })
  packPrice?: number;

  @ApiPropertyOptional({ description: 'Solo tamano_empaque: > 0, hasta 3 decimales, en promoUnit.', example: 1200 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'promoContent debe ser numérico, con máximo 3 decimales' })
  @Min(0.001, { message: 'promoContent debe ser mayor a 0' })
  promoContent?: number;

  @ApiPropertyOptional({ description: 'Solo tamano_empaque: clave de GET /v1/units de catalog (kg, g, l, ml, pza…).', example: 'g' })
  @IsOptional()
  @IsString({ message: 'promoUnit debe ser texto' })
  @Length(1, 10, { message: 'promoUnit debe tener entre 1 y 10 caracteres' })
  promoUnit?: string;

  @ApiPropertyOptional({ description: 'Solo tamano_empaque: MXN > 0, 2 decimales.', example: 30 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'promoPrice debe ser numérico, con máximo 2 decimales' })
  @Min(0.01, { message: 'promoPrice debe ser mayor a 0' })
  promoPrice?: number;

  @ApiProperty({ example: '2026-11-01', description: 'Día local de America/Monterrey, inclusivo; ≥ hoy.' })
  @IsString({ message: MENSAJE_FECHA('validFrom') })
  @Matches(FECHA, { message: MENSAJE_FECHA('validFrom') })
  validFrom: string;

  @ApiProperty({ example: '2026-11-15', description: 'Día local, inclusivo; ≥ validFrom.' })
  @IsString({ message: MENSAJE_FECHA('validTo') })
  @Matches(FECHA, { message: MENSAJE_FECHA('validTo') })
  validTo: string;
}

/** `PATCH /v1/promotions/:id/reject` (§10). */
export class RechazarPromocionDto {
  @ApiProperty({ example: 'El descuento se encima con la campaña de regreso a clases.', minLength: 10, maxLength: 500 })
  @IsString({ message: 'reason debe tener entre 10 y 500 caracteres' })
  @Length(10, 500, { message: 'reason debe tener entre 10 y 500 caracteres' })
  reason: string;
}

/** `GET /v1/promotions` (§7). */
export class ListarPromocionesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ESTATUS, description: 'vigente NO es un estado: para eso está activeOn.' })
  @IsOptional()
  @IsIn(ESTATUS as string[], { message: `status debe ser uno de: ${ESTATUS.join(', ')}` })
  status?: EstatusPromocion;

  @ApiPropertyOptional({ enum: TIPOS_PROMOCION })
  @IsOptional()
  @IsIn(TIPOS_PROMOCION, { message: `type debe ser uno de: ${TIPOS_PROMOCION.join(', ')}` })
  type?: TipoPromocion;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'productId debe ser un UUID' })
  productId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'presentationId debe ser un UUID' })
  presentationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'storeId debe ser un UUID' })
  storeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all', { message: 'zoneId debe ser un UUID' })
  zoneId?: string;

  @ApiPropertyOptional({ example: '2026-11-05', description: 'Aprobadas vigentes ese día (día local).' })
  @IsOptional()
  @Matches(FECHA, { message: MENSAJE_FECHA('activeOn') })
  activeOn?: string;
}

/** `GET /v1/promotions/:id/unit-price` (§11). */
export class PrecioUnitarioDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Obligatorio si la promoción es por zona.' })
  @IsOptional()
  @IsUUID('all', { message: 'storeId debe ser un UUID' })
  storeId?: string;
}

/** `ids=a,b` o `ids=a&ids=b`: a arreglo, sin espacios y en minúsculas. */
function aListaDeIds({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  const crudos = Array.isArray(value) ? value : [value];
  return crudos.flatMap((v) => String(v).split(',')).map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0);
}

/** `GET /v1/promotions/compare` (§12). */
export class CompararPromocionesDto {
  @ApiProperty({ description: 'De 2 a 10 ids de promoción del mismo producto: ids=a,b,c o ids=a&ids=b.', type: [String] })
  @Transform(aListaDeIds)
  @IsArray({ message: 'ids es obligatorio: de 2 a 10 UUID de promoción' })
  @ArrayMinSize(2, { message: 'ids debe traer de 2 a 10 promociones' })
  @ArrayMaxSize(10, { message: 'ids debe traer de 2 a 10 promociones' })
  @ArrayUnique({ message: 'ids no debe repetir promociones' })
  @IsUUID('all', { each: true, message: 'cada elemento de ids debe ser un UUID' })
  ids: string[];

  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'storeId es obligatorio y debe ser un UUID' })
  storeId: string;
}

