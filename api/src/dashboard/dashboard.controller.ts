import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS } from '../common/roles';
import { AnalyticsFilterDto } from '../analytics/dto/analytics-filter.dto';
import { DashboardService } from './dashboard.service';

/**
 * M16 — Tablero de negocio. Todo solo lectura para cualquier perfil
 * interno (el Auditor lo consulta; el Proveedor, externo, no entra).
 */
@ApiTags('M16 Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('kpis-generales')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'KPIs generales del negocio (globales, sin filtros).' })
  @ApiOkResponse({ description: 'Transacciones, canastas, ticket, productos, zonas y básicos.' })
  getKpisGenerales() {
    return this.dashboardService.getKpisGenerales();
  }

  @Get('comportamiento')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Frecuencia de compra y categorías principales, con filtros de M09.' })
  @ApiOkResponse({ description: 'Frecuencia, ticket, productos, unidades y gasto por categoría.' })
  getComportamiento(@Query() filters: AnalyticsFilterDto) {
    return this.dashboardService.getComportamiento(filters);
  }
}
