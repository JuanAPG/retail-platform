import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ZonesService } from './zones.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ZoneFilterDto } from './dto/zone-filter.dto';

/**
 * M03 — Zonas y su catálogo territorial. Se agrupan en un solo controlador
 * porque `municipalities` existe únicamente para dar de alta zonas.
 * Contrato: docs/contratos/catalog-service.md
 */
@ApiTags('M03 Zones')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller()
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Get('zones')
  @Roles(...PERFILES_INTERNOS)
  findAll(@Query() filtros: ZoneFilterDto) {
    return this.zonesService.findAll(filtros);
  }

  @Get('municipalities')
  @Roles(...PERFILES_INTERNOS)
  findMunicipalities() {
    return this.zonesService.findMunicipalities();
  }

  // Declarada ANTES que 'zones/:id', para que 'compare' no se
  // interprete como un id de zona.
  @Get('zones/compare')
  @Roles(...PERFILES_INTERNOS)
  @ApiQuery({ name: 'ids', required: true, description: 'Ids de zona (UUID) separados por coma.' })
  compareZones(@Query('ids') ids?: string) {
    const zoneIds = (ids ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (zoneIds.length === 0) {
      throw new BadRequestException('Manda al menos un id en ?ids=uuid1,uuid2.');
    }
    // Sin esto, un id mal formado llega a Postgres (`::uuid[]`) y sube como 500.
    if (!zoneIds.every((id) => isUUID(id))) {
      throw new BadRequestException('Todos los ids de ?ids= deben ser UUID.');
    }
    return this.zonesService.compareZones(zoneIds);
  }

  @Get('zones/:id')
  @Roles(...PERFILES_INTERNOS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.zonesService.findOne(id);
  }

  @Post('zones')
  @Roles(ROL.ADMINISTRADOR)
  create(@Body() dto: CreateZoneDto) {
    return this.zonesService.create(dto);
  }

  @Patch('zones/:id')
  @Roles(ROL.ADMINISTRADOR)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateZoneDto) {
    return this.zonesService.update(id, dto);
  }

  @Delete('zones/:id')
  @HttpCode(204)
  @Roles(ROL.ADMINISTRADOR)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.zonesService.remove(id);
  }
}
