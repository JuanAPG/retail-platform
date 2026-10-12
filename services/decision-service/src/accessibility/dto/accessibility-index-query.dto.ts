import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

/** Tope de `segmentos_ingreso.id` (SMALLSERIAL): arriba de esto Postgres truena. */
const SEGMENTO_ID_MAXIMO = 32767;

export class AccessibilityIndexQueryDto {
  @ApiProperty({ description: 'UUID de la zona' })
  @IsUUID(undefined, { message: 'zoneId debe ser un UUID válido.' })
  zoneId: string;

  @ApiProperty({ description: 'ID del segmento de ingreso', example: 2 })
  @Type(() => Number)
  @IsInt({ message: 'segmentId debe ser un número entero.' })
  @Min(1, { message: 'segmentId debe ser mayor a 0.' })
  @Max(SEGMENTO_ID_MAXIMO, { message: `segmentId no puede ser mayor a ${SEGMENTO_ID_MAXIMO}.` })
  segmentId: number;
}
