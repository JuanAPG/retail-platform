import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { CapturesService } from './captures.service';
import { CoverageService } from './coverage.service';
import { CaptureFilterDto, CreateCaptureDto, ShortageQueryDto, StockFilterDto } from './dto/availability.dto';

/**
 * Disponibilidad (D-38). Contrato: docs/contratos/availability-service.md.
 * Permisos (Matriz §3.2): capturan el Investigador de mercado (D-28) y el
 * Analista comercial; leen los 6 perfiles internos; el Proveedor no entra.
 */
@ApiTags('Availability')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('availability')
export class AvailabilityController {
  constructor(
    private readonly captures: CapturesService,
    private readonly coverage: CoverageService,
    private readonly audit: AuditReporter,
  ) {}

  @Post('captures')
  @XmlRoot('captureResponse')
  @Roles(ROL.INVESTIGADOR, ROL.ANALISTA)
  @ApiOperation({
    summary: 'Registra la existencia de una presentación en una tienda.',
    description:
      '`aceptada` (201): es el dato más reciente y actualiza la existencia. `conflicto` (201): el servidor ya tenía un dato capturado después; ' +
      'se guarda pero no sobrescribe (D-42). `duplicada` (200): ese `captureId` ya se había recibido; no se crea nada.',
  })
  @ApiRespuesta(201, 'Captura aceptada o en conflicto.', muestras.captura, 'captureResponse')
  @ApiRespuesta(200, 'Captura duplicada: se devuelve el resultado original.', { ...muestras.captura, status: 'duplicada' }, 'captureResponse')
  @ApiErrores(400, 401, 403, 409)
  async capture(
    @Body() dto: CreateCaptureDto,
    @CurrentUser() usuario: SesionUsuario,
    @Res({ passthrough: true }) respuesta: { status(codigo: number): unknown },
    @Headers('authorization') token?: string,
  ) {
    const { capture, previo } = await this.captures.capture(dto, usuario.id);
    if (capture.status === 'duplicada') {
      respuesta.status(200);
      return capture;
    }
    const donde = `tienda ${capture.storeId}, presentación ${capture.presentationId}`;
    if (capture.status === 'aceptada') {
      this.audit.reportar(
        {
          tabla: 'inventario',
          registroId: `${capture.storeId}:${capture.presentationId}`,
          accion: 'update',
          descripcion: `Existencia capturada (${capture.origin}) en ${donde}.`,
          cambios: [{ campo: 'stock_disponible', previo: previo === null ? null : String(previo), posterior: String(capture.stock) }],
        },
        token,
      );
    } else {
      this.audit.reportar(
        {
          tabla: 'disponibilidad_capturas',
          registroId: capture.captureId,
          accion: 'insert',
          descripcion: `Captura en conflicto (${capture.origin}) en ${donde}: no sobrescribió el dato del servidor (D-42).`,
        },
        token,
      );
    }
    return capture;
  }

  @Get('captures')
  @XmlRoot('captureListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Bitácora de capturas (aceptadas y en conflicto), la más reciente primero.' })
  @ApiRespuesta(200, 'Página de capturas.', pagina([muestras.capturaListada]), 'captureListResponse')
  @ApiErrores(400, 401, 403)
  findCaptures(@Query() filtros: CaptureFilterDto) {
    return this.captures.findCaptures(filtros);
  }

  @Get('stock')
  @XmlRoot('stockListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Existencia actual por tienda y presentación.',
    description: 'Un dato de más de 7 días sale como `vencido`: no se puede afirmar ni que hay ni que falta (D-38).',
  })
  @ApiRespuesta(200, 'Página de existencias.', pagina([muestras.existencia]), 'stockListResponse')
  @ApiErrores(400, 401, 403)
  findStock(@Query() filtros: StockFilterDto) {
    return this.captures.findStock(filtros);
  }

  @Get('stores/:storeId/coverage')
  @XmlRoot('storeCoverageResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Cobertura de la canasta básica en una tienda: % de básicos con existencia vigente.',
    description:
      'Un básico se cubre con cualquiera de sus presentaciones. Sin datos vigentes sale `disponible: false` con motivo y sin `coverage` (nunca 0).',
  })
  @ApiRespuesta(200, 'Cobertura de la tienda.', muestras.coberturaTienda, 'storeCoverageResponse')
  @ApiErrores(400, 401, 403, 404)
  storeCoverage(@Param('storeId', ParseUUIDPipe) storeId: string, @Headers('authorization') token?: string) {
    return this.coverage.storeCoverage(storeId, token);
  }

  @Get('zones/:zoneId/coverage')
  @XmlRoot('zoneCoverageResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Cobertura de la canasta básica en una zona (componente de disponibilidad de la accesibilidad).',
    description: '`storeShare` es el % de tiendas de la zona donde el básico tiene existencia (D-13: baja disponibilidad si < 50).',
  })
  @ApiRespuesta(200, 'Cobertura de la zona.', muestras.coberturaZona, 'zoneCoverageResponse')
  @ApiErrores(400, 401, 403, 404)
  zoneCoverage(@Param('zoneId', ParseUUIDPipe) zoneId: string, @Headers('authorization') token?: string) {
    return this.coverage.zoneCoverage(zoneId, token);
  }

  @Get('shortages')
  @XmlRoot('shortageListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Faltantes: básicos con dato vigente y existencia 0 en todas sus presentaciones.',
    description: 'Exige exactamente uno de `storeId` o `zoneId`. Sin paginar.',
  })
  @ApiRespuesta(200, 'Faltantes de la tienda o de la zona.', muestras.faltantes, 'shortageListResponse')
  @ApiErrores(400, 401, 403, 404)
  shortages(@Query() query: ShortageQueryDto, @Headers('authorization') token?: string) {
    return this.coverage.shortages(query, token);
  }
}
