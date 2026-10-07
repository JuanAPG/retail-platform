import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsPositive, IsUUID, Max } from 'class-validator';

/**
 * M06 — Una línea de la transacción. Apunta a la PRESENTACIÓN
 * (RF-35), nunca al producto: el producto sale por join.
 *
 * `maxDecimalPlaces: 2` no es cosmético: las columnas son NUMERIC(10,2) y
 * NUMERIC(12,2), así que un tercer decimal se redondearía en la base y el
 * total dejaría de cuadrar con Σ `subtotal` (ver `money.util.ts`).
 */
export class CreateTransactionDetailDto {
  @ApiProperty({ description: 'Id de la presentación (producto_presentaciones.id).' })
  @IsUUID('4', { message: 'presentationId debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'presentationId es obligatorio.' })
  presentationId: string;

  @ApiProperty({ example: 2, description: 'Hasta 2 decimales (piezas o kilos según la presentación).' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'quantity debe ser numérica con máximo 2 decimales.' })
  @IsPositive({ message: 'quantity debe ser mayor que cero.' })
  @Max(99999999.99, { message: 'quantity excede el máximo admitido.' })
  quantity: number;

  @ApiProperty({ example: 42.5, description: 'Precio al que se vendió (se congela aquí). Hasta 2 decimales.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'unitPrice debe ser numérico con máximo 2 decimales.' })
  @IsPositive({ message: 'unitPrice debe ser mayor que cero.' })
  @Max(9999999999.99, { message: 'unitPrice excede el máximo admitido.' })
  unitPrice: number;
}
