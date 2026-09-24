import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsPositive, IsUUID } from 'class-validator';

/**
 * M06 — Una línea de la transacción. Apunta a la PRESENTACIÓN
 * (RF-35), nunca al producto: el producto sale por join.
 */
export class CreateTransactionDetailDto {
  @ApiProperty({ description: 'Id de la presentación (producto_presentaciones.id).' })
  @IsUUID('4', { message: 'presentationId debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'presentationId es obligatorio.' })
  presentationId: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsNumber({}, { message: 'quantity debe ser numérica.' })
  @IsPositive({ message: 'quantity debe ser mayor que cero.' })
  quantity: number;

  @ApiProperty({ example: 42.5, description: 'Precio al que se vendió (se congela aquí).' })
  @Type(() => Number)
  @IsNumber({}, { message: 'unitPrice debe ser numérico.' })
  @IsPositive({ message: 'unitPrice debe ser mayor que cero.' })
  unitPrice: number;
}
