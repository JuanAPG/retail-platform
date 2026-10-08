import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { SimulationService } from './simulation.service';
import { PriceSimulationDto } from './dto/price-simulation.dto';
import { PresentationSimulationDto } from './dto/presentation-simulation.dto';
import { PresentationComparisonResult } from './dto/presentation-comparison-result.dto';
import { SimulationResult } from './dto/simulation-result.dto';
import { CompareScenariosQueryDto } from './dto/compare-scenarios-query.dto';
import { ScenarioComparison } from './dto/scenario-comparison.dto';
import { ScenarioPage } from './dto/scenario-summary.dto';

/**
 * M13 — Simulación de escenarios. Cada simulación (precio o presentación)
 * se guarda automáticamente como escenario: por eso no hay un endpoint
 * separado para "guardar", solo para simular y para consultar. Mismo
 * criterio de roles que M11/M14: Administrador y Analista para lo que
 * calcula/guarda, cualquier perfil interno para consultar.
 */
@ApiTags('M13 Simulation')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('simulation')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Post('price')
  @XmlRoot('simulacionPrecioResponse')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({ summary: 'Simula un cambio de precio con la elasticidad ya calculada y guarda el escenario.' })
  @ApiCreatedResponse({ type: SimulationResult })
  simulatePriceChange(@Body() dto: PriceSimulationDto, @CurrentUser() user: SesionUsuario) {
    return this.simulationService.simulatePriceChange(dto, user);
  }

  @Post('presentation')
  @XmlRoot('simulacionPresentacionResponse')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({
    summary:
      'Compara las presentaciones de un mismo producto (desembolso, precio por unidad base, demanda, accesibilidad) y guarda el escenario.',
  })
  @ApiCreatedResponse({ type: PresentationComparisonResult })
  simulatePresentationChange(@Body() dto: PresentationSimulationDto, @CurrentUser() user: SesionUsuario) {
    return this.simulationService.simulatePresentationChange(dto, user);
  }

  @Get('scenarios')
  @XmlRoot('simulacionEscenariosResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Lista paginada de los escenarios guardados, con su tipo e insumos.' })
  @ApiOkResponse({ type: ScenarioPage })
  findAllScenarios(@Query() filtros: PaginationDto) {
    return this.simulationService.findAllScenarios(filtros);
  }

  @Get('compare')
  @XmlRoot('simulacionCompareResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Compara varios escenarios guardados entre sí (ids=a,b o ids=a&ids=b).' })
  @ApiOkResponse({ type: ScenarioComparison })
  compareScenarios(@Query() query: CompareScenariosQueryDto) {
    return this.simulationService.compareScenarios(query.ids);
  }
}
