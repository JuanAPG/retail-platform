import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

/**
 * M06 — Confirma una importación ya validada. `previewId` es el id de
 * la fila de `importaciones` que devolvió el preview: solo las filas
 * marcadas como válidas se convierten en transacciones.
 */
export class ConfirmCsvImportDto {
  @ApiProperty({ description: 'Id de la importación (lo que devolvió el preview).' })
  @IsUUID('4', { message: 'previewId debe ser un UUID válido.' })
  @IsNotEmpty({ message: 'previewId es obligatorio.' })
  previewId: string;
}
