import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsUUID } from 'class-validator';

export class PriceSimulationDto {
  @ApiProperty({ description: 'UUID de la presentación cuyo precio se simula' })
  @IsUUID()
  presentationId: string;

  @ApiProperty({ description: 'UUID de la zona donde se simula el cambio' })
  @IsUUID()
  zoneId: string;

  @ApiProperty({ description: 'Precio nuevo propuesto', example: 25.5 })
  @IsNumber()
  @IsPositive()
  newPrice: number;
}
