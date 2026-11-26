import { Body, Controller, Get, Headers, Ip, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { CuerpoXmlInterceptor } from '../common/xml/cuerpo-xml';
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

/** Ejemplos de petición XML (los mismos de `docs/contratos/decision-service.md`). */
export const EJEMPLO_XML_PRECIO = `<?xml version="1.0" encoding="UTF-8"?>
<simulacionPrecioRequest xmlns="decision/v1">
  <presentationId>8f14e45f-ceea-467a-9f3b-1c2d3e4f5a6b</presentationId>
  <zoneId>3c59dc04-8a1f-4d2e-b7c6-5e4f3a2b1c0d</zoneId>
  <newPrice>25.50</newPrice>
</simulacionPrecioRequest>`;

export const EJEMPLO_XML_PRESENTACION = `<?xml version="1.0" encoding="UTF-8"?>
<simulacionPresentacionRequest xmlns="decision/v1">
  <productId>a87ff679-a2f3-471d-8c3e-9b8a7c6d5e4f</productId>
  <zoneId>3c59dc04-8a1f-4d2e-b7c6-5e4f3a2b1c0d</zoneId>
  <presentationIds>
    <item>e4da3b7f-bbce-4345-9777-2b0674a318d5</item>
    <item>1679091c-5a88-4faf-afb5-e6087eb1b2dc</item>
    <item>8f14e45f-ceea-467a-9f3b-1c2d3e4f5a6c</item>
  </presentationIds>
</simulacionPresentacionRequest>`;

/**
 * M13 — Simulación de escenarios. Cada simulación (precio o presentación)
 * se guarda automáticamente como escenario: por eso no hay un endpoint
 * separado para "guardar", solo para simular y para consultar. Roles según
 * la matriz de permisos (M13): solo el Planeador simula/guarda (T);
 * Administrador, Analista y el resto de perfiles internos consultan (L).
 */
@ApiTags('M13 Simulation')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('simulation')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Post('price')
  @XmlRoot('simulacionPrecioResponse')
  @Roles(ROL.PLANEADOR)
  // Corre después de SessionGuard y RolesGuard y antes del ValidationPipe.
  @UseInterceptors(new CuerpoXmlInterceptor({ raiz: 'simulacionPrecioRequest', numeros: ['newPrice'] }))
  @ApiConsumes('application/json', 'application/xml')
  @ApiBody({
    type: PriceSimulationDto,
    description:
      'JSON, o XML con raíz `<simulacionPrecioRequest xmlns="decision/v1">` (máx. 1 MB, sin DOCTYPE). Ejemplo XML:\n\n```xml\n' +
      EJEMPLO_XML_PRECIO +
      '\n```',
  })
  @ApiOperation({ summary: 'Simula un cambio de precio con la elasticidad ya calculada y guarda el escenario.' })
  @ApiCreatedResponse({ type: SimulationResult })
  simulatePriceChange(
    @Body() dto: PriceSimulationDto,
    @CurrentUser() user: SesionUsuario,
    @Headers('authorization') token: string | undefined,
    @Ip() ip: string,
  ) {
    // El token y la IP van a la bitácora (audit-service exige sesión).
    return this.simulationService.simulatePriceChange(dto, user, { token, ip });
  }

  @Post('presentation')
  @XmlRoot('simulacionPresentacionResponse')
  @Roles(ROL.PLANEADOR)
  @UseInterceptors(new CuerpoXmlInterceptor({ raiz: 'simulacionPresentacionRequest', listas: ['presentationIds'] }))
  @ApiConsumes('application/json', 'application/xml')
  @ApiBody({
    type: PresentationSimulationDto,
    description:
      'JSON, o XML con raíz `<simulacionPresentacionRequest xmlns="decision/v1">` (máx. 1 MB, sin DOCTYPE). Ejemplo XML:\n\n```xml\n' +
      EJEMPLO_XML_PRESENTACION +
      '\n```',
  })
  @ApiOperation({
    summary:
      'Compara las presentaciones de un mismo producto (desembolso, precio por unidad base, demanda, accesibilidad) y guarda el escenario.',
  })
  @ApiCreatedResponse({ type: PresentationComparisonResult })
  simulatePresentationChange(
    @Body() dto: PresentationSimulationDto,
    @CurrentUser() user: SesionUsuario,
    @Headers('authorization') token: string | undefined,
    @Ip() ip: string,
  ) {
    return this.simulationService.simulatePresentationChange(dto, user, { token, ip });
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
