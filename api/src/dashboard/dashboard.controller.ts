import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS } from '../common/roles';
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
}
