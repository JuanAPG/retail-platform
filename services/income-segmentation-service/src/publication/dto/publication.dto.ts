import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class PublicationQueryDto {
  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @Matches(FECHA, { message: 'dateFrom debe tener el formato YYYY-MM-DD.' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @Matches(FECHA, { message: 'dateTo debe tener el formato YYYY-MM-DD.' })
  dateTo?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Solo esta zona.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'zoneId debe ser un UUID.' })
  zoneId?: string;
}
