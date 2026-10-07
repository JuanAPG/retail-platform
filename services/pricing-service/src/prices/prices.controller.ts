import { Body, Controller, Get, Ip, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, ApiRespuesta, pagina } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { CreatePriceDto } from './dto/create-price.dto';
import { PriceComparisonQueryDto, PriceHistoryQueryDto } from './dto/price-queries.dto';
import { PricesService } from './prices.service';

/**
 * M08 — Precios. Nomenclatura tal como quedó en `Contrato_Metodos_Endpoints`
 * (Sprint 1): en inglés y con las rutas que Elasticidad (M11) y
 * Accesibilidad (M12) esperan. Contrato: docs/contratos/pricing-service.md
 */
@ApiTags('M08 Prices')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('prices')
export class PricesController {
  constructor(private readonly pricesService: PricesService) {}

  @Post()
  @Roles(ROL.ADMINISTRADOR, ROL.RESPONSABLE_PRECIOS)
  @ApiOperation({
    summary:
      'Registra un precio por presentación y tienda. Si había uno vigente, lo cierra el día anterior (el histórico no se sobrescribe).',
  })
  @ApiRespuesta(201, 'Precio registrado, ya vigente.', muestras.precio)
  @ApiErrores(400, 401, 403, 409)
  create(@Body() dto: CreatePriceDto, @CurrentUser() usuario: SesionUsuario, @Ip() ip: string) {
    return this.pricesService.create(dto, usuario, ip);
  }

  @Get('history')
  @XmlRoot('priceListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Histórico de precios de un producto (o de una presentación), paginado, lo más reciente primero.',
  })
  @ApiRespuesta(200, 'Página del histórico.', pagina([muestras.precio, muestras.precioCerrado]))
  @ApiErrores(400, 401, 403, 404)
  findHistory(@Query() filtros: PriceHistoryQueryDto) {
    return this.pricesService.findHistory(filtros);
  }

  @Get('compare-zones')
  @XmlRoot('priceComparisonResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Compara el precio vigente de un producto entre zonas (agregado para gráficas, sin paginar).',
  })
  @ApiRespuesta(200, 'Promedio, mínimo, máximo y número de tiendas por zona.', muestras.comparacion)
  @ApiErrores(400, 401, 403, 404)
  compareAcrossZones(@Query() filtros: PriceComparisonQueryDto) {
    return this.pricesService.compareAcrossZones(filtros.productId);
  }
}
