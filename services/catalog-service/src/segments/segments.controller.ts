import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { SegmentsService } from './segments.service';
import { SegmentFilterDto } from './dto/segment-filter.dto';
import { AuditarInterceptor } from '../common/audit/auditar.interceptor';
import { escrituraMovidaASegmentation } from '../common/retirado';

/** M05 — Segmentos de ingreso. Contrato: docs/contratos/catalog-service.md */
@ApiTags('M05 Segments')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditarInterceptor)
@Controller('segments')
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @Post()
  @Roles(ROL.ANALISTA)
  @ApiOperation({
    summary: 'RETIRADA (D-35): crear segmentos es de income-segmentation-service, POST :3112/v1/segments. Responde 409.',
    deprecated: true,
  })
  @ApiErrores(401, 403, 409)
  create() {
    throw escrituraMovidaASegmentation('POST /v1/segments');
  }

  @Get()
  @XmlRoot('segmentListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Lista paginada de segmentos, de menor a mayor ingreso mínimo.' })
  @ApiRespuesta(200, 'Página de segmentos.', pagina([muestras.segmento]), 'segmentListResponse')
  @ApiErrores(400, 401, 403)
  findAll(@Query() filtros: SegmentFilterDto) {
    return this.segmentsService.findAll(filtros);
  }

  @Get(':id')
  @XmlRoot('segmentResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Detalle de un segmento.' })
  @ApiRespuesta(200, 'El segmento.', muestras.segmento, 'segmentResponse')
  @ApiErrores(400, 401, 403, 404)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.segmentsService.findOne(id);
  }

  @Patch(':id')
  @Roles(ROL.ANALISTA)
  @ApiOperation({
    summary: 'RETIRADA (D-35): editar segmentos es de income-segmentation-service, PATCH :3112/v1/segments/:id (crea versión). Responde 409.',
    deprecated: true,
  })
  @ApiErrores(401, 403, 409)
  update() {
    throw escrituraMovidaASegmentation('PATCH /v1/segments/:id');
  }

  @Delete(':id')
  @Roles(ROL.ANALISTA)
  @ApiOperation({
    summary: 'RETIRADA (D-35): borrar segmentos es de income-segmentation-service, DELETE :3112/v1/segments/:id. Responde 409.',
    deprecated: true,
  })
  @ApiErrores(401, 403, 409)
  remove() {
    throw escrituraMovidaASegmentation('DELETE /v1/segments/:id');
  }
}
