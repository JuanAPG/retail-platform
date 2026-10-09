import { Body, Controller, Get, Headers, Ip, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { APRUEBAN_PRECIOS, CAPTURAN_OBSERVACIONES, VEN_OBSERVACIONES } from '../common/roles';
import { ApiErrores, ApiRespuesta, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import {
  ApprovePriceObservationDto,
  CreatePriceObservationDto,
  PriceObservationQueryDto,
  RejectPriceObservationDto,
} from './dto/price-observation.dto';
import { PriceObservationsService } from './price-observations.service';

/**
 * PRI-09 / D-16 — Precios observados en tienda (app móvil). Contrato: docs/contratos/pricing-service.md
 *
 * Acceso diferenciado: capturan el Analista y el Responsable de precios (POR CONFIRMAR, ver `CAPTURAN_OBSERVACIONES`);
 * ven la bandeja el Responsable de precios, el Administrador, el Auditor y el Analista (solo lo suyo); y resuelve
 * ÚNICAMENTE el Responsable de precios, igual que las propuestas de proveedor (D1).
 */
@ApiTags('M08 Price observations')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('price-observations')
export class PriceObservationsController {
  constructor(private readonly observaciones: PriceObservationsService) {}

  @Post()
  @XmlRoot('priceObservationResponse')
  @Roles(...CAPTURAN_OBSERVACIONES)
  @ApiOperation({
    summary:
      'Registra un precio levantado en tienda (app móvil). Nace pendiente y NO cambia el precio actual hasta que el Responsable de precios lo apruebe.',
  })
  @ApiRespuesta(201, 'Observación registrada, pendiente.', muestras.observacion, 'priceObservationResponse')
  @ApiErrores(400, 401, 403, 409)
  create(
    @Body() dto: CreatePriceObservationDto,
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
    @Headers('authorization') token: string | undefined,
  ) {
    return this.observaciones.create(dto, usuario, ip, token);
  }

  @Get()
  @XmlRoot('priceObservationListResponse')
  @Roles(...VEN_OBSERVACIONES)
  @ApiOperation({
    summary: 'Bandeja de precios observados, paginada. Con `status=pendiente` es una cola (la más antigua primero). El Analista solo ve las suyas.',
  })
  @ApiRespuesta(200, 'Página de observaciones.', pagina([muestras.observacion]), 'priceObservationListResponse')
  @ApiErrores(400, 401, 403)
  findAll(@CurrentUser() usuario: SesionUsuario, @Query() filtros: PriceObservationQueryDto) {
    return this.observaciones.findAll(usuario, filtros);
  }

  @Patch(':id/approve')
  @XmlRoot('priceObservationResponse')
  @Roles(...APRUEBAN_PRECIOS)
  @ApiOperation({
    summary:
      'Aprueba una observación pendiente: entra al historial como un precio normal (cierra el vigente) y la bitácora la marca como observada en campo.',
  })
  @ApiRespuesta(200, 'Observación aprobada.', { ...muestras.observacion, status: 'aprobado' }, 'priceObservationResponse')
  @ApiErrores(400, 401, 403, 404, 409)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePriceObservationDto,
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
    @Headers('authorization') token: string | undefined,
  ) {
    return this.observaciones.approve(id, dto, usuario, ip, token);
  }

  @Patch(':id/reject')
  @XmlRoot('priceObservationResponse')
  @Roles(...APRUEBAN_PRECIOS)
  @ApiOperation({ summary: 'Rechaza una observación pendiente; exige motivo de al menos 10 caracteres.' })
  @ApiRespuesta(200, 'Observación rechazada.', { ...muestras.observacion, status: 'rechazado' }, 'priceObservationResponse')
  @ApiErrores(400, 401, 403, 404, 409)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPriceObservationDto,
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
    @Headers('authorization') token: string | undefined,
  ) {
    return this.observaciones.reject(id, dto, usuario, ip, token);
  }
}
