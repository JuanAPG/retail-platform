import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RechazarProductoDto {
  /**
   * Obligatorio por dos razones: el proveedor necesita saber qué
   * corregir, y el CHECK `chk_producto_rechazo` del esquema no permite
   * guardar un producto en estatus 'rechazado' sin motivo.
   */
  @ApiProperty({ example: 'La ficha técnica no acredita el certificado orgánico.' })
  @IsString()
  @MinLength(10, { message: 'Explica el motivo del rechazo (mínimo 10 caracteres).' })
  motivoRechazo: string;
}
