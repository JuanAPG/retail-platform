import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Ip,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SessionGuard, SesionUsuario } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { XmlRoot } from '../../common/decorators/xml-root.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LEEN_REPORTES } from '../../common/roles';
import { ApiErrores, ApiRespuesta } from '../../common/swagger/ejemplos';
import { ExportarReporteDto } from '../dto/reports.dto';
import { muestras } from '../muestras';
import { nombreDescarga } from '../reports.service';
import { ALMACEN_OBJETOS, AlmacenObjetos } from './almacen/almacen';
import { LocalAlmacen } from './almacen/local.almacen';
import { ArchivosService } from './archivos.service';
import { ESTADO_ARCHIVO } from './archivo.schema';
import { FormatoExportacion } from '../dto/reports.dto';

/**
 * Archivos privados de un reporte (contrato docs/contratos/registro-archivos.md).
 * Permiso por rol igual que la descarga directa (`LEEN_REPORTES`, Matriz M16) y
 * por recurso en el servicio: un Proveedor con un reporte ajeno recibe 404.
 */
@ApiTags('M16 Report files')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('reports/:id/files')
export class ArchivosController {
  constructor(private readonly archivos: ArchivosService) {}

  @Post()
  @XmlRoot('fileResponse')
  @Roles(...LEEN_REPORTES)
  @ApiOperation({
    summary: 'Genera el archivo privado del reporte guardado (pdf, xlsx o csv) y lo sube al almacén. Idempotente por reporte y formato.',
    description:
      '201 = se generó ahora; 200 = ya estaba disponible (no sube otro objeto ni repite el aviso); 202 = otro intento lo está generando. ' +
      'Si el almacén falla responde 503 y el registro queda `fallido`; la misma petición lo reintenta.',
  })
  @ApiRespuesta(201, 'Archivo generado y disponible.', muestras.archivo, 'fileResponse')
  @ApiRespuesta(202, 'Otro intento lo está generando.', { ...muestras.archivo, estado: 'pendiente', ruta: null, tamanoBytes: null, sha256: null, disponibleEn: null }, 'fileResponse')
  @ApiErrores(400, 401, 403, 404, 503)
  async preparar(
    @Param('id') id: string,
    @Body() dto: ExportarReporteDto,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') authorization: string | undefined,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { archivo, status } = await this.archivos.preparar(id, dto.format, usuario, authorization, ip);
    res.status(status);
    return archivo;
  }

  @Get()
  @XmlRoot('fileListResponse')
  @Roles(...LEEN_REPORTES)
  @ApiOperation({ summary: 'Archivos del reporte con su estado (pendiente, disponible o fallido).' })
  @ApiRespuesta(200, 'Archivos del reporte.', { data: [muestras.archivo, { ...muestras.archivoFallido, formato: 'csv' }] }, 'fileListResponse')
  @ApiErrores(400, 401, 403, 404)
  async listar(@Param('id') id: string, @CurrentUser() usuario: SesionUsuario) {
    return { data: await this.archivos.listar(id, usuario) };
  }

  @Get(':fileId')
  @XmlRoot('fileResponse')
  @Roles(...LEEN_REPORTES)
  @ApiOperation({ summary: 'Un archivo del reporte (para consultar su estado mientras se prepara).' })
  @ApiRespuesta(200, 'El archivo.', muestras.archivo, 'fileResponse')
  @ApiErrores(400, 401, 403, 404)
  obtener(@Param('id') id: string, @Param('fileId', new ParseUUIDPipe()) fileId: string, @CurrentUser() usuario: SesionUsuario) {
    return this.archivos.obtener(id, fileId, usuario);
  }

  @Post(':fileId/download-url')
  @HttpCode(200)
  @XmlRoot('downloadUrlResponse')
  @Roles(...LEEN_REPORTES)
  @ApiOperation({
    summary: 'Emite una URL firmada de vida corta (5 min por defecto, tope 15) para descargar el archivo. Autoriza antes de firmar.',
    description: 'La URL no se guarda ni se escribe en logs. La bitácora registra la EMISIÓN; la lectura efectiva del objeto la registra el almacén.',
  })
  @ApiRespuesta(200, 'URL firmada.', muestras.urlDescarga, 'downloadUrlResponse')
  @ApiErrores(400, 401, 403, 404, 409, 503)
  emitirUrl(
    @Param('id') id: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
    @CurrentUser() usuario: SesionUsuario,
    @Headers('authorization') authorization: string | undefined,
    @Ip() ip: string,
  ) {
    return this.archivos.emitirUrl(id, fileId, usuario, authorization, ip);
  }
}

/**
 * Descarga del DOBLE LOCAL del almacén (solo con `ARCHIVOS_ALMACEN=local`).
 * Sin JWT a propósito: como una URL firmada de GCS, la firma ES la
 * autorización, emitida por `download-url` después de validar sesión y
 * permiso. Firma alterada o vencida → 404 (no confirma que exista).
 */
@Controller('files/local')
export class DescargaLocalController {
  private readonly logger = new Logger(DescargaLocalController.name);

  constructor(
    private readonly archivos: ArchivosService,
    @Inject(ALMACEN_OBJETOS) private readonly almacen: AlmacenObjetos,
  ) {}

  @Get(':fileId')
  @ApiExcludeEndpoint()
  async descargar(
    @Param('fileId') fileId: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const local = this.almacen instanceof LocalAlmacen ? this.almacen : null;
    if (!local || !local.firmaValida(fileId, Number(exp), String(sig ?? ''))) throw new NotFoundException('El archivo no existe.');
    const doc = await this.archivos.porIdParaDescargaLocal(fileId);
    if (!doc || doc.estado !== ESTADO_ARCHIVO.DISPONIBLE || !doc.ruta) throw new NotFoundException('El archivo no existe.');
    const contenido = await local.leer(doc.ruta);
    await this.archivos.registrarLectura(fileId);
    // "Objeto leído" (distinto de "URL emitida"): se loguea sin la firma.
    this.logger.log(JSON.stringify({ evento: 'objeto_leido', archivoId: fileId, bytes: contenido.length }));
    const creado = new Date(String(doc.metadatos?.reporteCreadoEn ?? doc.creadoEn));
    res.set({
      'Content-Type': doc.tipoContenido,
      'Content-Disposition': `attachment; filename="${nombreDescarga({ creadoEn: creado }, doc.formato as FormatoExportacion)}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(contenido);
  }
}
