import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERFILES_INTERNOS, ROL, UsuarioSolicitante } from '../common/roles';
import { SimulationService } from './simulation.service';
import { PriceSimulationDto } from './dto/price-simulation.dto';
import { PresentationSimulationDto } from './dto/presentation-simulation.dto';
import { SimulationResult } from './dto/simulation-result.dto';
import { ScenarioComparison } from './dto/scenario-comparison.dto';
import { Scenario } from '../entities/scenario.entity';

/**
 * M13 — Simulación de escenarios. Cada simulación (precio o presentación)
 * se guarda automáticamente como escenario, igual que
 * AssociationService.runApriori guarda vía saveRun (M10): por eso no hay
 * un endpoint separado para "guardar", solo para simular y para consultar.
 * Mismo criterio de roles que M10/M11: Administrador y Analista para lo
 * que calcula/guarda, cualquier perfil interno para consultar.
 */
@ApiTags('M13 Simulation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('simulation')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Post('price')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({ summary: 'Simula un cambio de precio con la elasticidad ya calculada y guarda el escenario.' })
  @ApiCreatedResponse({ type: SimulationResult })
  simulatePriceChange(@Body() dto: PriceSimulationDto, @CurrentUser() user: UsuarioSolicitante) {
    return this.simulationService.simulatePriceChange(dto, user);
  }

  @Post('presentation')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({ summary: 'Compara dos presentaciones (desembolso, precio unitario, demanda) y guarda el escenario.' })
  @ApiCreatedResponse({ type: SimulationResult })
  simulatePresentationChange(@Body() dto: PresentationSimulationDto, @CurrentUser() user: UsuarioSolicitante) {
    return this.simulationService.simulatePresentationChange(dto, user);
  }

  @Get('scenarios')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Lista los escenarios guardados.' })
  @ApiOkResponse({ type: [Scenario] })
  findAllScenarios() {
    return this.simulationService.findAllScenarios();
  }

  @Get('compare')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Compara varios escenarios guardados entre sí.' })
  @ApiOkResponse({ type: ScenarioComparison })
  compareScenarios(@Query('ids') ids: string) {
    return this.simulationService.compareScenarios(ids.split(','));
  }
}
