import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidateNested,
} from 'class-validator';
import { CreateTransactionDetailDto } from './create-transaction-detail.dto';
import { NoEsFechaFutura } from './no-es-fecha-futura.validator';

/**
 * M06 — Registro manual de una transacción.
 * Una transacción = una canasta (RN-03): al guardarla se construye
 * su canasta vía `BasketsService.buildFromTransaction()`.
 */
export class CreateTransactionDto {
  @ApiProperty({ description: 'Id de la tienda donde se vendió.' })
  @IsUUID('4', { message: 'storeId debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'storeId es obligatorio.' })
  storeId: string;

  @ApiProperty({ example: 'T-2026-0001', description: 'Folio único dentro de la tienda.' })
  @IsString()
  @IsNotEmpty({ message: 'folio es obligatorio.' })
  @MaxLength(40, { message: 'folio admite máximo 40 caracteres.' })
  folio: string;

  @ApiProperty({
    example: '2026-09-18',
    description: 'Fecha de la venta (ISO). No puede ser futura, igual que en la importación CSV.',
  })
  @IsDateString({}, { message: 'fecha debe ser una fecha ISO válida.' })
  @IsNotEmpty({ message: 'fecha es obligatoria.' })
  @Validate(NoEsFechaFutura)
  fecha: string;

  @ApiProperty({ type: [CreateTransactionDetailDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'La transacción necesita al menos una línea.' })
  @ValidateNested({ each: true })
  @Type(() => CreateTransactionDetailDto)
  details: CreateTransactionDetailDto[];
}
