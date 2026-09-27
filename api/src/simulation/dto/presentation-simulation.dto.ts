import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class PresentationSimulationDto {
  @ApiProperty({ description: 'UUID de la presentación base (A)' })
  @IsUUID()
  presentationIdA: string;

  @ApiProperty({ description: 'UUID de la presentación alternativa a comparar (B)' })
  @IsUUID()
  presentationIdB: string;

  @ApiPropertyOptional({
    description: 'UUID de zona para tomar precio/demanda local; si se omite, usa datos nacionales',
  })
  @IsOptional()
  @IsUUID()
  zoneId?: string;
}
