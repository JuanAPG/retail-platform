import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { IsFechaIso } from '../../common/validators/fecha-calendario';
import { ESTATUS_PROPUESTA } from '../../entities/price-proposal.entity';

/**
 * Lo que un Proveedor puede proponer. Deliberadamente NO incluye `supplierId`
 * (sale de su cuenta: si viniera en el cuerpo podría proponer a nombre de otra
 * empresa) ni `status` (toda propuesta nace `pendiente`). El `ValidationPipe`
 * global rechaza la petición si se intentan mandar.
 */
export class CreatePriceProposalDto {
  @ApiProperty({ description: 'Id de una presentación de un producto de tu empresa.' })
  @IsUUID()
  @IsNotEmpty({ message: 'presentationId es obligatorio.' })
  presentationId: string;

  @ApiProperty({ example: 38 })
  @Type(() => Number)
  @IsNumber({}, { message: 'proposedPrice debe ser numérico.' })
  @IsPositive({ message: 'proposedPrice debe ser mayor que cero.' })
  proposedPrice: number;

  @ApiPropertyOptional({ example: 'caja 12 pzas', description: 'Dato informativo.' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  purchaseUnit?: string;
}

/** Quién aprueba decide a qué tiendas se aplica el precio y desde cuándo. */
export class ApprovePriceProposalDto {
  @ApiProperty({ type: [String], description: 'Tiendas (UUID) donde se aplica el precio. De 1 a 50, sin repetir.' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Indica al menos una tienda en storeIds.' })
  @ArrayMaxSize(50, { message: 'storeIds admite como máximo 50 tiendas.' })
  @ArrayUnique({ message: 'storeIds no debe repetir tiendas.' })
  @IsUUID(undefined, { each: true, message: 'Cada elemento de storeIds debe ser un UUID.' })
  storeIds: string[];

  @ApiPropertyOptional({ example: '2026-10-05', description: 'Fecha desde la que aplica (YYYY-MM-DD). Por omisión, hoy.' })
  @IsOptional()
  @IsFechaIso({ message: 'effectiveDate debe ser una fecha válida (YYYY-MM-DD).' })
  effectiveDate?: string;
}

export class RejectPriceProposalDto {
  /**
   * Obligatorio: el proveedor necesita saber qué corregir, y el CHECK
   * `chk_precio_propuesto_rechazo` del esquema no permite guardar una propuesta
   * rechazada sin motivo.
   */
  @ApiProperty({ example: 'El precio propuesto excede el límite de variación de la zona.' })
  @IsString()
  @MinLength(10, { message: 'Explica el motivo del rechazo (mínimo 10 caracteres).' })
  rejectionReason: string;
}

/** Query de `GET /v1/price-proposals`: paginación estándar + estatus opcional. */
export class PriceProposalQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: Object.values(ESTATUS_PROPUESTA) })
  @IsOptional()
  @IsIn(Object.values(ESTATUS_PROPUESTA), { message: 'status debe ser pendiente, aprobado o rechazado.' })
  status?: string;
}
