import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS } from '../common/roles';
import { ZonesService } from './zones.service';

/**
 * Zonas y su catálogo territorial. Se agrupan en un solo controlador
 * porque `municipios` existe únicamente para dar de alta zonas: no
 * tiene sentido que viva en otro módulo.
 */
@ApiTags('M03 Zonas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Get('zonas')
  @Roles(...PERFILES_INTERNOS)
  findZonas() {
    return this.zonesService.findZonas();
  }

  @Get('municipios')
  @Roles(...PERFILES_INTERNOS)
  findMunicipios() {
    return this.zonesService.findMunicipios();
  }
}
