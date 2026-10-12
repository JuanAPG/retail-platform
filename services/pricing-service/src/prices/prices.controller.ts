import { Body, Controller, Get, Headers, Ip, Post, Query, UseGuards } from '@nestjs/common';
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
import { PriceComparisonQueryDto, PriceCurrentQueryDto, PriceHistoryQueryDto, PriceSeriesQueryDto } from './dto/price-queries.dto';
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
  @XmlRoot('priceResponse')
  @Roles(ROL.RESPONSABLE_PRECIOS)
  @ApiOperation({
    summary:
      'Registra un precio por presentación y tienda. Si había uno vigente, lo cierra el día anterior (el histórico no se sobrescribe).',
  })
  @ApiRespuesta(201, 'Precio registrado, ya vigente.', muestras.precio, 'priceResponse')
  @ApiErrores(400, 401, 403, 409)
  create(
    @Body() dto: CreatePriceDto,
    @CurrentUser() usuario: SesionUsuario,
    @Ip() ip: string,
    @Headers('authorization') token: string | undefined,
  ) {
    return this.pricesService.create(dto, usuario, ip, token);
  }

  @Get('history')
  @XmlRoot('priceListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Histórico de precios de un producto (o de una presentación), paginado, lo más reciente primero.',
  })
  @ApiRespuesta(200, 'Página del histórico.', pagina([muestras.precio, muestras.precioCerrado]), 'priceListResponse')
  @ApiErrores(400, 401, 403, 404)
  findHistory(@Query() filtros: PriceHistoryQueryDto) {
    return this.pricesService.findHistory(filtros);
  }

  @Get('current')
  @XmlRoot('priceListResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary:
      'Precio ACTUAL (por fecha, no por la bandera vigente) de una presentación, uno por tienda; filtra por zona o tienda. Un precio programado a futuro no aparece hasta su fecha.',
  })
  @ApiRespuesta(200, 'Página de precios actuales.', pagina([muestras.precio]), 'priceListResponse')
  @ApiErrores(400, 401, 403, 404)
  findCurrent(@Query() filtros: PriceCurrentQueryDto) {
    return this.pricesService.findCurrent(filtros);
  }

  @Get('series')
  @XmlRoot('priceSeriesResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary:
      'Serie completa de precios de una presentación (todas las tiendas, con zona y rango de vigencia), SIN paginar. Para elasticidad y simulación.',
  })
  @ApiRespuesta(200, 'Todos los precios del periodo.', { data: [muestras.precio, muestras.precioCerrado], total: 2 }, 'priceSeriesResponse')
  @ApiErrores(400, 401, 403, 404)
  findSeries(@Query() filtros: PriceSeriesQueryDto) {
    return this.pricesService.findSeries(filtros);
  }

  @Get('compare-zones')
  @XmlRoot('priceComparisonResponse')
  @Roles(...PERFILES_INTERNOS, ROL.PROVEEDOR)
  @ApiOperation({
    summary:
      'Compara el precio vigente de un producto entre zonas (agregado para gráficas, sin paginar). Un Proveedor solo puede consultar productos suyos.',
  })
  @ApiRespuesta(200, 'Promedio, mínimo, máximo y número de tiendas por zona.', muestras.comparacion, 'priceComparisonResponse')
  @ApiErrores(400, 401, 403, 404)
  compareAcrossZones(@Query() filtros: PriceComparisonQueryDto, @CurrentUser() usuario: SesionUsuario) {
    return this.pricesService.compareAcrossZones(filtros.productId, usuario);
  }
}
