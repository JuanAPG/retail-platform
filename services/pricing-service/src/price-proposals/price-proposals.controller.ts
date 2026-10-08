import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { APRUEBAN_PRECIOS, ROL, VEN_PROPUESTAS_PRECIO } from '../common/roles';
import { ApiErrores, ApiRespuesta, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import {
  ApprovePriceProposalDto,
  CreatePriceProposalDto,
  PriceProposalQueryDto,
  RejectPriceProposalDto,
} from './dto/price-proposal.dto';
import { PriceProposalsService } from './price-proposals.service';

/**
 * Propuestas de precio del Proveedor (RN-14). Contrato:
 * docs/contratos/pricing-service.md
 *
 * Acceso diferenciado: por ruta (`@Roles`), por dato (un Proveedor solo ve
 * sus propuestas) y por acción (proponer es del Proveedor; resolver, de quien
 * aprueba).
 */
@ApiTags('M08 Price proposals')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('price-proposals')
export class PriceProposalsController {
  constructor(private readonly proposalsService: PriceProposalsService) {}

  @Post()
  @XmlRoot('priceProposalResponse')
  @Roles(ROL.PROVEEDOR)
  @ApiOperation({
    summary:
      'Un Proveedor propone un precio para una presentación de su producto. Nace pendiente y ligada a su empresa (no acepta supplierId ni status).',
  })
  @ApiRespuesta(201, 'Propuesta registrada, pendiente de aprobación.', muestras.propuesta, 'priceProposalResponse')
  @ApiErrores(400, 401, 403, 409)
  create(
    @Body() dto: CreatePriceProposalDto,
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
    @Headers('authorization') token: string | undefined,
  ) {
    return this.proposalsService.create(dto, usuario, ip, token);
  }

  @Get()
  @XmlRoot('priceProposalListResponse')
  @Roles(...VEN_PROPUESTAS_PRECIO)
  @ApiOperation({
    summary:
      'Propuestas de precio, paginadas. Un Proveedor recibe únicamente las suyas. Con status=pendiente es la bandeja de revisión (la más antigua primero).',
  })
  @ApiRespuesta(200, 'Página de propuestas.', pagina([muestras.propuesta]), 'priceProposalListResponse')
  @ApiErrores(400, 401, 403)
  findAll(@CurrentUser() usuario: SesionUsuario, @Query() filtros: PriceProposalQueryDto) {
    return this.proposalsService.findAll(usuario, filtros);
  }

  @Patch(':id/approve')
  @XmlRoot('priceProposalApproveResponse')
  @Roles(...APRUEBAN_PRECIOS)
  @ApiOperation({
    summary:
      'Aprueba una propuesta pendiente y aplica su precio a las tiendas indicadas (cierra el vigente de cada una). Todo o nada.',
  })
  @ApiRespuesta(200, 'Propuesta aprobada y los precios que se crearon.', muestras.aprobacion, 'priceProposalApproveResponse')
  @ApiErrores(400, 401, 403, 404, 409)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePriceProposalDto,
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
    @Headers('authorization') token: string | undefined,
  ) {
    return this.proposalsService.approve(id, dto, usuario, ip, token);
  }

  @Patch(':id/reject')
  @XmlRoot('priceProposalResponse')
  @Roles(...APRUEBAN_PRECIOS)
  @ApiOperation({ summary: 'Rechaza una propuesta pendiente; exige motivo de al menos 10 caracteres.' })
  @ApiRespuesta(200, 'Propuesta rechazada, con su motivo.', muestras.propuestaRechazada, 'priceProposalResponse')
  @ApiErrores(400, 401, 403, 404, 409)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPriceProposalDto,
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
    @Headers('authorization') token: string | undefined,
  ) {
    return this.proposalsService.reject(id, dto, usuario, ip, token);
  }
}
