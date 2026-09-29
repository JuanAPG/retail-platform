import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { AccessibilityService } from './accessibility.service';

/**
 * M12 — Igual criterio que M11 (elasticity.controller.ts): calcular es
 * Administrador/Analista, leer el historial es cualquier perfil interno.
 * Antes no tenía guards: cualquiera sin sesión podía calcular o leer
 * accesibilidad por zona.
 */
@ApiTags('M12 Accessibility')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('accessibility')
export class AccessibilityController {
  constructor(private readonly accessibilityService: AccessibilityService) {}

  @Get('index')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({ summary: 'Calcula el índice de accesibilidad de una zona (crea una corrida nueva cada vez)' })
  @ApiQuery({ name: 'zoneId', type: String, description: 'UUID de la zona' })
  @ApiQuery({ name: 'segmentId', type: String, description: 'ID del segmento de ingreso' })
  calculateIndex(@Query('zoneId') zoneId: string, @Query('segmentId') segmentId: string) {
    return this.accessibilityService.calculateIndex(zoneId, segmentId);
  }

  @Get('by-zone/:zoneId')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Historial de corridas de accesibilidad de una zona' })
  @ApiParam({ name: 'zoneId', type: String, description: 'UUID de la zona' })
  findByZone(@Param('zoneId') zoneId: string) {
    return this.accessibilityService.findByZone(zoneId);
  }
}