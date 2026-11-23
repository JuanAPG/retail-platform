import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta, ApiSinCuerpo, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { CreateSegmentDto, SegmentFilterDto, UpdateSegmentDto } from './dto/segment.dto';
import { SegmentsService } from './segments.service';

/**
 * Segmentos de ingreso versionados (D-35). Contrato:
 * docs/contratos/income-segmentation-service.md. Permisos de M05: escribe el
 * Analista comercial, leen los 6 perfiles internos; Proveedor e Investigador
 * de mercado no entran.
 */
@ApiTags('Segments')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('segments')
export class SegmentsController {
  constructor(
    private readonly segments: SegmentsService,
    private readonly audit: AuditReporter,
  ) {}

  @Post()
  @XmlRoot('segmentResponse')
  @Roles(ROL.ANALISTA)
  @ApiOperation({ summary: 'Crea un segmento de ingreso en su versión 1 (solo Analista comercial).' })
  @ApiRespuesta(201, 'Segmento creado.', { ...muestras.segmento, version: 1 }, 'segmentResponse')
  @ApiErrores(400, 401, 403, 409)
  async create(
    @Body() dto: CreateSegmentDto,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') token?: string,
  ) {
    const segment = await this.segments.create(dto, usuario.id);
    this.audit.reportar(
      { tabla: 'segmentos_ingreso', registroId: String(segment.id), accion: 'insert', descripcion: `Alta del segmento ${segment.code} (versión 1).` },
      token,
    );
    return segment;
  }

  @Get()
  @XmlRoot('segmentListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Segmentos en su versión vigente, de menor a mayor ingreso mínimo.' })
  @ApiRespuesta(200, 'Página de segmentos.', pagina([muestras.segmento]), 'segmentListResponse')
  @ApiErrores(400, 401, 403)
  findAll(@Query() filtros: SegmentFilterDto) {
    return this.segments.findAll(filtros);
  }

  @Get(':id')
  @XmlRoot('segmentResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Un segmento en su versión vigente.' })
  @ApiRespuesta(200, 'El segmento.', muestras.segmento, 'segmentResponse')
  @ApiErrores(400, 401, 403, 404)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.segments.findOne(id);
  }

  @Get(':id/versions')
  @XmlRoot('segmentVersionListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Historial de versiones del segmento, la más reciente primero (D-35).' })
  @ApiRespuesta(200, 'Página de versiones.', pagina([muestras.version]), 'segmentVersionListResponse')
  @ApiErrores(400, 401, 403, 404)
  findVersions(@Param('id', ParseIntPipe) id: number, @Query() filtros: SegmentFilterDto) {
    return this.segments.findVersions(id, filtros);
  }

  @Get(':id/versions/:version')
  @XmlRoot('segmentVersionResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Una versión del segmento: sigue consultable aunque ya no sea la vigente.' })
  @ApiRespuesta(200, 'La versión.', muestras.version, 'segmentVersionResponse')
  @ApiErrores(400, 401, 403, 404)
  findVersion(@Param('id', ParseIntPipe) id: number, @Param('version', ParseIntPipe) version: number) {
    return this.segments.findVersion(id, version);
  }

  @Patch(':id')
  @XmlRoot('segmentResponse')
  @Roles(ROL.ANALISTA)
  @ApiOperation({
    summary: 'Edita el segmento creando una versión nueva; la anterior se conserva (D-35).',
    description: 'No acepta `code`. Si el cuerpo no cambia ningún valor, no se crea versión. Rango encimado → 400 (D-10).',
  })
  @ApiRespuesta(200, 'Segmento en su versión nueva.', muestras.segmento, 'segmentResponse')
  @ApiErrores(400, 401, 403, 404, 409)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSegmentDto,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') token?: string,
  ) {
    const { segment, cambios } = await this.segments.update(id, dto, usuario.id);
    if (cambios.length > 0) {
      this.audit.reportar(
        {
          tabla: 'segmentos_ingreso',
          registroId: String(segment.id),
          accion: 'update',
          descripcion: `Versión ${segment.version} del segmento ${segment.code}.`,
          cambios,
        },
        token,
      );
    }
    return segment;
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(ROL.ANALISTA)
  @ApiOperation({ summary: 'Elimina un segmento sin historial. Con zonas clasificadas (hoy o antes) → 409.' })
  @ApiSinCuerpo(204, 'Eliminado, sin cuerpo.')
  @ApiErrores(400, 401, 403, 404, 409)
  async remove(@Param('id', ParseIntPipe) id: number, @Headers('authorization') token?: string): Promise<void> {
    const segment = await this.segments.remove(id);
    this.audit.reportar(
      { tabla: 'segmentos_ingreso', registroId: String(segment.id), accion: 'delete', descripcion: `Baja del segmento ${segment.code}.` },
      token,
    );
  }
}
