import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateZoneDto } from './create-zone.dto';

export class UpdateZoneDto extends PartialType(CreateZoneDto) {
  @ApiPropertyOptional({ description: 'Activa o desactiva la zona sin borrarla.' })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
