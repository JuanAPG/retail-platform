import { Body, Controller, Get, Headers, Ip, Param, Patch, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { GENERAN_REPORTES, LEEN_REPORTES } from '../common/roles';
import { ApiErrores, ApiRespuesta, ApiSinCuerpo, pagina } from '../common/swagger/ejemplos';
import { ActualizarReporteDto, ExportarReporteDto, GenerarReporteEjecutivoDto, ListarReportesDto } from './dto/reports.dto';
import { muestras } from './muestras';
import { ReportsService } from './reports.service';

/** M16 — Reportes ejecutivos. Contrato: docs/contratos/documents-service.md */
@ApiTags('M16 Reports')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportes: ReportsService) {}

  @Post('executive')
  @XmlRoot('reportResponse')
  @Roles(...GENERAN_REPORTES)
  @ApiOperation({
    summary:
      'Genera el reporte ejecutivo de 16 indicadores consultando a los servicios dueños. Un servicio que no responde en 3 s deja su indicador como no disponible (nunca 0).',
  })
  @ApiRespuesta(201, 'Reporte generado y guardado en MongoDB.', muestras.reporte, 'reportResponse')
  @ApiErrores(400, 401, 403)
  generar(
    @Body() dto: GenerarReporteEjecutivoDto,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') authorization: string | undefined,
    @Ip() ip: string,
  ) {
    return this.reportes.generarEjecutivo(dto, usuario, authorization, ip);
  }

  @Get()
  @XmlRoot('reportListResponse')
  @Roles(...LEEN_REPORTES)
  @ApiOperation({ summary: 'Historial de reportes, paginado, el más reciente primero. Un Proveedor solo ve los suyos.' })
  @ApiRespuesta(200, 'Página de reportes.', pagina([muestras.reporte]), 'reportListResponse')
  @ApiErrores(400, 401, 403)
  listar(@Query() filtros: ListarReportesDto, @CurrentUser() usuario: SesionUsuario) {
    return this.reportes.listar(filtros, usuario);
  }

  // Declarada ANTES que ':id' para que 'stats' no se interprete como un id.
  @Get('stats/by-user-month')
  @XmlRoot('reportStatsResponse')
  @Roles(...LEEN_REPORTES)
  @ApiOperation({ summary: 'Agregación: reportes generados por usuario y mes.' })
  @ApiRespuesta(200, 'Conteos por usuario y mes.', { data: [muestras.estadistica] }, 'reportStatsResponse')
  @ApiErrores(401, 403)
  async estadisticas(@CurrentUser() usuario: SesionUsuario) {
    return { data: await this.reportes.estadisticasPorUsuarioMes(usuario) };
  }

  @Get(':id')
  @XmlRoot('reportResponse')
  @Roles(...LEEN_REPORTES)
  @ApiOperation({ summary: 'Un reporte guardado. Un Proveedor recibe 404 con el de otro.' })
  @ApiRespuesta(200, 'El reporte.', muestras.reporte, 'reportResponse')
  @ApiErrores(400, 401, 403, 404)
  obtener(@Param('id') id: string, @CurrentUser() usuario: SesionUsuario) {
    return this.reportes.obtener(id, usuario);
  }

  @Patch(':id')
  @XmlRoot('reportResponse')
  @Roles(...GENERAN_REPORTES)
  @ApiOperation({ summary: 'Cambia el estado del reporte (generado o exportado).' })
  @ApiRespuesta(200, 'Reporte actualizado.', { ...muestras.reporte, estado: 'exportado' }, 'reportResponse')
  @ApiErrores(400, 401, 403, 404)
  actualizar(@Param('id') id: string, @Body() dto: ActualizarReporteDto, @CurrentUser() usuario: SesionUsuario) {
    return this.reportes.actualizarEstado(id, dto, usuario);
  }

  @Get(':id/export')
  @Roles(...LEEN_REPORTES)
  @ApiOperation({ summary: 'Exporta el reporte guardado a PDF (format=pdf) o Excel (format=xlsx, cifras como celdas numéricas). Mismos números que el JSON.' })
  @ApiSinCuerpo(200, 'Archivo PDF (application/pdf) o Excel (.xlsx) con Content-Disposition: attachment.')
  @ApiErrores(400, 401, 403, 404)
  async exportar(
    @Param('id') id: string,
    @Query() query: ExportarReporteDto,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') authorization: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, nombre, formato } = await this.reportes.exportar(id, query.format, usuario, authorization, ip);
    res.set({
      'Content-Type': formato === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
      'Content-Disposition': `attachment; filename="${nombre}"`,
    });
    return new StreamableFile(buffer);
  }
}
