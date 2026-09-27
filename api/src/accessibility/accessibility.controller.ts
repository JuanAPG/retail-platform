import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { AccessibilityService } from './accessibility.service';

@ApiTags('M12 Accessibility')
@Controller('accessibility')
export class AccessibilityController {
  constructor(private readonly accessibilityService: AccessibilityService) {}

  @Get('index')
  @ApiOperation({ summary: 'Calcula el índice de accesibilidad de una zona (crea una corrida nueva cada vez)' })
  @ApiQuery({ name: 'zoneId', type: String, description: 'UUID de la zona' })
  @ApiQuery({ name: 'segmentId', type: String, description: 'ID del segmento de ingreso' })
  calculateIndex(@Query('zoneId') zoneId: string, @Query('segmentId') segmentId: string) {
    return this.accessibilityService.calculateIndex(zoneId, segmentId);
  }

  @Get('by-zone/:zoneId')
  @ApiOperation({ summary: 'Historial de corridas de accesibilidad de una zona' })
  @ApiParam({ name: 'zoneId', type: String, description: 'UUID de la zona' })
  findByZone(@Param('zoneId') zoneId: string) {
    return this.accessibilityService.findByZone(zoneId);
  }
}