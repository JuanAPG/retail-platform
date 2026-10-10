import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { AccessibilityService } from './accessibility.service';
import { AccessibilityIndexQueryDto } from './dto/accessibility-index-query.dto';

/**
 * M12 — Igual criterio que M11 (elasticity.controller.ts del monolito):
 * calcular es Administrador/Analista, leer el historial es cualquier
 * perfil interno.
 */
@ApiTags('M12 Accessibility')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('accessibility')
export class AccessibilityController {
  constructor(private readonly accessibilityService: AccessibilityService) {}

  @Get('index')
  @XmlRoot('indiceAccesibilidad')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({ summary: 'Calcula el índice de accesibilidad de una zona (crea una corrida nueva cada vez)' })
  calculateIndex(@Query() query: AccessibilityIndexQueryDto) {
    return this.accessibilityService.calculateIndex(query.zoneId, query.segmentId);
  }

  @Get('by-zone/:zoneId')
  @XmlRoot('indiceAccesibilidad')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Accesibilidad vigente de una zona (su corrida más reciente)' })
  @ApiParam({ name: 'zoneId', type: String, description: 'UUID de la zona' })
  findByZone(
    @Param(
      'zoneId',
      // El mensaje va en arreglo, como los del ValidationPipe: así el filtro
      // común lo pasa a `details` y el 400 sale con la misma forma.
      new ParseUUIDPipe({
        exceptionFactory: () => new BadRequestException(['zoneId debe ser un UUID válido.']),
      }),
    )
    zoneId: string,
  ) {
    return this.accessibilityService.findByZone(zoneId);
  }
}
