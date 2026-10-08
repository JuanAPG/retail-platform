import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { ApiErrores, ApiRespuesta, ApiSinCuerpo, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { SegmentsService } from './segments.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { SegmentFilterDto } from './dto/segment-filter.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';
import { Auditar, AuditarInterceptor } from '../common/audit/auditar.interceptor';

/** M05 — Segmentos de ingreso. Contrato: docs/contratos/catalog-service.md */
@ApiTags('M05 Segments')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditarInterceptor)
@Controller('segments')
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @Post()
  @XmlRoot('segmentResponse')
  @Roles(ROL.ANALISTA)
  @Auditar('segmentos_ingreso', 'insert')
  @ApiOperation({ summary: 'Crea un segmento de ingreso (Administrador, Analista comercial).' })
  @ApiRespuesta(201, 'Segmento creado.', muestras.segmento, 'segmentResponse')
  @ApiErrores(400, 401, 403, 409)
  create(@Body() dto: CreateSegmentDto) {
    return this.segmentsService.create(dto);
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
  @XmlRoot('segmentResponse')
  @Roles(ROL.ANALISTA)
  @Auditar('segmentos_ingreso', 'update')
  @ApiOperation({ summary: 'Edita un segmento; todos los campos son opcionales.' })
  @ApiRespuesta(200, 'Segmento actualizado.', muestras.segmento, 'segmentResponse')
  @ApiErrores(400, 401, 403, 404, 409)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSegmentDto) {
    return this.segmentsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(ROL.ANALISTA)
  @Auditar('segmentos_ingreso', 'delete')
  @ApiOperation({ summary: 'Elimina un segmento (solo Administrador). 409 si hay zonas clasificadas con él.' })
  @ApiSinCuerpo(204, 'Eliminado, sin cuerpo.')
  @ApiErrores(400, 401, 403, 404, 409)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.segmentsService.remove(id);
  }
}
