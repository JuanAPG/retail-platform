import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { PaginaDto } from '../common/dto/pagina.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { ClassificationsService } from './classifications.service';
import { ClassificationFilterDto, ClassifyZoneDto } from './dto/classification.dto';

/**
 * Clasificación de zonas en un segmento de ingreso (D-35). Es parte de M05:
 * la escribe el Analista comercial y la leen los 6 perfiles internos.
 */
@ApiTags('Zone classifications')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller()
export class ClassificationsController {
  constructor(
    private readonly classifications: ClassificationsService,
    private readonly audit: AuditReporter,
  ) {}

  @Get('zone-classifications')
  @XmlRoot('zoneClassificationListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Clasificaciones de zona, vigentes e históricas.',
    description: '`asOf=YYYY-MM-DD` devuelve las que valían ese día: sirve para analizar un periodo pasado con la clasificación de entonces.',
  })
  @ApiRespuesta(200, 'Página de clasificaciones.', pagina([muestras.clasificacion]), 'zoneClassificationListResponse')
  @ApiErrores(400, 401, 403)
  findAll(@Query() filtros: ClassificationFilterDto) {
    return this.classifications.findAll(filtros);
  }

  @Get('zones/:zoneId/classification')
  @XmlRoot('zoneClassificationResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Clasificación vigente de la zona, con la versión del segmento con la que se hizo.' })
  @ApiRespuesta(200, 'La clasificación vigente.', muestras.clasificacion, 'zoneClassificationResponse')
  @ApiErrores(400, 401, 403, 404)
  current(@Param('zoneId', ParseUUIDPipe) zoneId: string) {
    return this.classifications.current(zoneId);
  }

  @Get('zones/:zoneId/classification/history')
  @XmlRoot('zoneClassificationListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Historial de clasificaciones de la zona, la más reciente primero.' })
  @ApiRespuesta(200, 'Página del historial.', pagina([muestras.clasificacion]), 'zoneClassificationListResponse')
  @ApiErrores(400, 401, 403)
  history(@Param('zoneId', ParseUUIDPipe) zoneId: string, @Query() filtros: PaginaDto) {
    return this.classifications.history(zoneId, filtros);
  }

  @Put('zones/:zoneId/classification')
  @XmlRoot('zoneClassificationResponse')
  @Roles(ROL.ANALISTA)
  @ApiOperation({
    summary: 'Clasifica la zona en un segmento (solo Analista comercial).',
    description: 'Cierra la clasificación vigente (el historial se conserva) y crea la nueva con la versión vigente del segmento. Si ya estaba en ese segmento y esa versión, no cambia nada.',
  })
  @ApiRespuesta(200, 'La clasificación que queda vigente.', muestras.clasificacion, 'zoneClassificationResponse')
  @ApiErrores(400, 401, 403, 404, 409)
  async classify(
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Body() dto: ClassifyZoneDto,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') token?: string,
  ) {
    const { classification, previa, cambio } = await this.classifications.classify(zoneId, dto.segmentId, usuario.id, token);
    if (cambio) {
      this.audit.reportar(
        {
          tabla: 'zona_clasificaciones',
          registroId: classification.id,
          accion: 'update',
          descripcion: `Zona ${zoneId} clasificada en ${classification.segmentCode} versión ${classification.segmentVersion}.`,
          cambios: [
            { campo: 'segmento_manual_id', previo: previa ? String(previa.segmentId) : null, posterior: String(classification.segmentId) },
            { campo: 'segmento_version', previo: previa ? String(previa.segmentVersion) : null, posterior: String(classification.segmentVersion) },
          ],
        },
        token,
      );
    }
    return classification;
  }
}
