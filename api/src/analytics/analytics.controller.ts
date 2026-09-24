import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS } from '../common/roles';
import { AnalyticsService } from './analytics.service';
import { AnalyticsFilterDto } from './dto/analytics-filter.dto';
import { CategorySpend } from './dto/category-spend.dto';

/**
 * M09 — Indicadores descriptivos. Solo lectura: cualquier perfil interno
 * puede consultarlos. Todos aceptan los mismos filtros (AnalyticsFilterDto).
 */
@ApiTags('M09 Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('average-ticket')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Ticket promedio (MXN por canasta).' })
  @ApiOkResponse({ type: Number })
  getAverageTicket(@Query() filters: AnalyticsFilterDto) {
    return this.analyticsService.getAverageTicket(filters);
  }

  @Get('products-per-basket')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Productos distintos promedio por canasta.' })
  @ApiOkResponse({ type: Number })
  getProductsPerBasket(@Query() filters: AnalyticsFilterDto) {
    return this.analyticsService.getProductsPerBasket(filters);
  }

  @Get('purchase-frequency')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Compras (canastas) por mes en el ámbito filtrado.' })
  @ApiOkResponse({ type: Number })
  getPurchaseFrequency(@Query() filters: AnalyticsFilterDto) {
    return this.analyticsService.getPurchaseFrequency(filters);
  }

  @Get('units-per-transaction')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Unidades promedio por transacción.' })
  @ApiOkResponse({ type: Number })
  getUnitsPerTransaction(@Query() filters: AnalyticsFilterDto) {
    return this.analyticsService.getUnitsPerTransaction(filters);
  }

  @Get('spend-by-category')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Gasto por categoría, de mayor a menor.' })
  @ApiOkResponse({ type: CategorySpend, isArray: true })
  getSpendByCategory(@Query() filters: AnalyticsFilterDto) {
    return this.analyticsService.getSpendByCategory(filters);
  }
}
