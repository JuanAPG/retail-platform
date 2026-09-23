import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ZonesService } from './zones.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';

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

  // Declarada ANTES que 'zonas/:id', para que 'compare' no se
  // interprete como un id de zona.
  @Get('zonas/compare')
  @Roles(...PERFILES_INTERNOS)
  @ApiQuery({ name: 'ids', required: true, description: 'Ids de zona separados por coma.' })
  compareZones(@Query('ids') ids?: string) {
    const zoneIds = (ids ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (zoneIds.length === 0) {
      throw new BadRequestException('Manda al menos un id en ?ids=1,2,3.');
    }
    return this.zonesService.compareZones(zoneIds);
  }

  @Get('zonas/:id')
  @Roles(...PERFILES_INTERNOS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.zonesService.findOne(id);
  }

  @Post('zonas')
  @Roles(ROL.ADMINISTRADOR)
  create(@Body() dto: CreateZoneDto) {
    return this.zonesService.create(dto);
  }

  @Patch('zonas/:id')
  @Roles(ROL.ADMINISTRADOR)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateZoneDto) {
    return this.zonesService.update(id, dto);
  }

  @Delete('zonas/:id')
  @Roles(ROL.ADMINISTRADOR)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.zonesService.remove(id);
  }
}
