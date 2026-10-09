import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta, ApiSinCuerpo, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { ZonesService } from './zones.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { ZoneClassificationDto, ZoneIndicatorsDto } from './dto/zone-indicators.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { ZoneFilterDto } from './dto/zone-filter.dto';
import { Auditar, AuditarInterceptor } from '../common/audit/auditar.interceptor';

/**
 * M03 — Zonas y su catálogo territorial. Se agrupan en un solo controlador
 * porque `municipalities` existe únicamente para dar de alta zonas.
 * Contrato: docs/contratos/catalog-service.md
 */
@ApiTags('M03 Zones')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditarInterceptor)
@Controller()
export class ZonesController {
  constructor(
    private readonly zonesService: ZonesService,
    private readonly audit: AuditReporter,
  ) {}

  @Get('zones')
  @XmlRoot('zoneListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Lista paginada de zonas, por nombre.' })
  @ApiRespuesta(200, 'Página de zonas.', pagina([muestras.zona]), 'zoneListResponse')
  @ApiErrores(400, 401, 403)
  findAll(@Query() filtros: ZoneFilterDto) {
    return this.zonesService.findAll(filtros);
  }

  @Get('municipalities')
  @XmlRoot('municipalityListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Catálogo de municipios (arreglo plano, sin paginar).' })
  @ApiRespuesta(200, 'Municipios ordenados por nombre.', [muestras.municipio], 'municipalityListResponse')
  @ApiErrores(401, 403)
  findMunicipalities() {
    return this.zonesService.findMunicipalities();
  }

  // Declarada ANTES que 'zones/:id', para que 'compare' no se
  // interprete como un id de zona.
  @Get('zones/compare')
  @XmlRoot('zoneCompareResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Compara 2 o más zonas distintas por clasificación vigente e indicadores (solo lectura, sin paginar). Ids repetidos se deduplican; un id inexistente es 404 y los lista.' })
  @ApiQuery({ name: 'ids', required: true, description: 'Ids de zona (UUID) separados por coma.' })
  @ApiRespuesta(200, 'Una fila por zona; los indicadores son null si Analítica aún no los calculó.', [
    muestras.comparacionZona,
  ], 'zoneCompareResponse')
  @ApiErrores(400, 401, 403, 404)
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
  @XmlRoot('zoneResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Detalle de una zona.' })
  @ApiRespuesta(200, 'La zona.', muestras.zona, 'zoneResponse')
  @ApiErrores(400, 401, 403, 404)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.zonesService.findOne(id);
  }

  @Post('zones')
  @XmlRoot('zoneResponse')
  @Roles(ROL.ANALISTA)
  @Auditar('zonas', 'insert')
  @ApiOperation({ summary: 'Crea una zona (solo Analista comercial).' })
  @ApiRespuesta(201, 'Zona creada, activa.', muestras.zona, 'zoneResponse')
  @ApiErrores(400, 401, 403, 409)
  create(@Body() dto: CreateZoneDto) {
    return this.zonesService.create(dto);
  }

  @Patch('zones/:id')
  @XmlRoot('zoneResponse')
  @Roles(ROL.ANALISTA)
  @Auditar('zonas', 'update')
  @ApiOperation({ summary: 'Edita una zona; `activo: false` la desactiva sin borrarla.' })
  @ApiRespuesta(200, 'Zona actualizada.', muestras.zona, 'zoneResponse')
  @ApiErrores(400, 401, 403, 404, 409)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateZoneDto) {
    return this.zonesService.update(id, dto);
  }

  @Put('zones/:id/indicators')
  @XmlRoot('zoneIndicatorsResponse')
  @Roles(ROL.ANALISTA)
  @ApiOperation({
    summary:
      'Carga el ingreso estimado, la población y la disponibilidad de una zona (solo Analista comercial). Deja una corrida de carga manual con su fuente y periodo.',
  })
  @ApiRespuesta(200, 'Indicadores cargados; los lee `GET /v1/zones/compare`.', muestras.indicadoresZona, 'zoneIndicatorsResponse')
  @ApiErrores(400, 401, 403, 404)
  async setIndicators(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ZoneIndicatorsDto,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') token: string | undefined,
    @Ip() ip: string,
  ) {
    const r = await this.zonesService.setIndicators(id, dto, usuario.id);
    await this.audit.reportar(
      {
        tabla: 'zonas',
        registroId: id,
        accion: 'update',
        descripcion: `Indicadores cargados a mano para la zona (${dto.periodoInicio} a ${dto.periodoFin}); fuente: ${dto.fuente}.`,
        cambios: [
          { campo: 'ingreso_estimado', previo: null, posterior: String(dto.ingresoEstimado) },
          { campo: 'poblacion', previo: null, posterior: String(dto.poblacion) },
          { campo: 'disponibilidad', previo: null, posterior: String(dto.disponibilidad) },
        ],
        ip,
      },
      token,
    );
    return r;
  }

  @Put('zones/:id/classification')
  @XmlRoot('zoneClassificationResponse')
  @Roles(ROL.ANALISTA)
  @ApiOperation({
    summary:
      'Clasifica la zona en un segmento de ingreso (solo Analista comercial). Cierra la clasificación vigente y crea la nueva; el historial se conserva.',
  })
  @ApiRespuesta(200, 'Clasificación vigente.', muestras.clasificacionZona, 'zoneClassificationResponse')
  @ApiErrores(400, 401, 403, 404)
  async setClassification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ZoneClassificationDto,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') token: string | undefined,
    @Ip() ip: string,
  ) {
    const r = await this.zonesService.setClassification(id, dto, usuario.id);
    await this.audit.reportar(
      {
        tabla: 'zonas',
        registroId: id,
        accion: 'update',
        descripcion: `Zona clasificada en el segmento ${r.segmentCode}.`,
        cambios: [{ campo: 'segmento', previo: r.previousSegmentId != null ? String(r.previousSegmentId) : null, posterior: String(r.segmentId) }],
        ip,
      },
      token,
    );
    return r;
  }

  @Delete('zones/:id')
  @HttpCode(204)
  @Roles(ROL.ANALISTA)
  @Auditar('zonas', 'delete')
  @ApiOperation({ summary: 'Elimina una zona. 409 si tiene tiendas asociadas (desactívala en su lugar).' })
  @ApiSinCuerpo(204, 'Eliminada, sin cuerpo.')
  @ApiErrores(400, 401, 403, 404, 409)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.zonesService.remove(id);
  }
}
