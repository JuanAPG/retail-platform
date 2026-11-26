import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS } from '../common/roles';
import { ApiErrores, ApiRespuesta } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { AnalyticsService } from './analytics.service';
import { AnalyticsFilterDto } from './dto/analytics-filter.dto';
import { WeeklySalesFilterDto } from './dto/weekly-sales-filter.dto';

/**
 * M09 — Indicadores descriptivos dentro de core-process-service.
 * Son agregaciones sobre canastas y transacciones, datos que este
 * servicio ya posee: no es un microservicio aparte. Solo lectura.
 */
@ApiTags('v1 Analytics')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('average-ticket')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Ticket promedio (MXN por canasta).' })
  @ApiRespuesta(200, 'Ticket promedio.', muestras.ticketPromedio)
  @ApiErrores(401, 403)
  getAverageTicket(@Query() filters: AnalyticsFilterDto) {
    return this.analyticsService.getAverageTicket(filters);
  }

  @Get('products-per-basket')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Productos distintos promedio por canasta.' })
  @ApiRespuesta(200, 'Productos por canasta.', muestras.productosPorCanasta)
  @ApiErrores(401, 403)
  getProductsPerBasket(@Query() filters: AnalyticsFilterDto) {
    return this.analyticsService.getProductsPerBasket(filters);
  }

  @Get('purchase-frequency')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Compras (canastas) por mes en el ámbito filtrado.' })
  @ApiRespuesta(200, 'Frecuencia de compra.', muestras.frecuenciaCompra)
  @ApiErrores(401, 403)
  getPurchaseFrequency(@Query() filters: AnalyticsFilterDto) {
    return this.analyticsService.getPurchaseFrequency(filters);
  }

  @Get('units-per-transaction')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Unidades promedio por transacción.' })
  @ApiRespuesta(200, 'Unidades por transacción.', muestras.unidadesPorTransaccion)
  @ApiErrores(401, 403)
  getUnitsPerTransaction(@Query() filters: AnalyticsFilterDto) {
    return this.analyticsService.getUnitsPerTransaction(filters);
  }

  @Get('spend-by-category')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Gasto por categoría, de mayor a menor.' })
  @ApiRespuesta(200, 'Gasto por categoría.', muestras.gastoPorCategoria)
  @ApiErrores(401, 403)
  getSpendByCategory(@Query() filters: AnalyticsFilterDto) {
    return this.analyticsService.getSpendByCategory(filters);
  }

  /** Ruta nueva del Sprint 4 (T-13): la consume demand-forecast-service. */
  @Get('weekly-sales')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Ventas de un producto por semana (lunes, hora de Monterrey) y presentación.',
    description:
      'Serie para el pronóstico de demanda. Cantidades en la unidad de cada presentación; ' +
      '`transactions` y `stores` del encabezado son distintos en toda la ventana. ' +
      '`asOf` fija la instantánea. Ver `docs/contratos/core-process-analytics.md`.',
  })
  @ApiRespuesta(200, 'Serie semanal del producto.', muestras.ventasSemanales)
  @ApiErrores(400, 401, 403)
  getWeeklySales(@Query() filters: WeeklySalesFilterDto) {
    return this.analyticsService.getWeeklySales(filters);
  }
}
