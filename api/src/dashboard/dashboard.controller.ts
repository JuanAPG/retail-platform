import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PERFILES_INTERNOS } from '../common/roles';
import { AnalyticsFilterDto } from '../analytics/dto/analytics-filter.dto';
import { SubstitutionQueryDto } from '../elasticity/dto/substitution-query.dto';
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

  @Get('asociaciones')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Asociaciones principales ordenadas por lift.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Máximo de reglas (default 10, máx 50).' })
  @ApiOkResponse({ description: 'Reglas con antecedente y consecuente en texto legible.' })
  getAsociaciones(@Query('limit', new ParseIntPipe({ optional: true })) limit?: number) {
    return this.dashboardService.getAsociaciones(limit ?? 10);
  }

  @Get('sustituciones')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Sustituciones detectadas en una categoría (cálculo al vuelo de M11).' })
  @ApiOkResponse({ description: 'Pares sustitutos con tipo y correlación.' })
  getSustituciones(@Query() query: SubstitutionQueryDto) {
    return this.dashboardService.getSustituciones(query.categoryId);
  }

  @Get('elasticidad')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Elasticidad promedio y conteo por clasificación.' })
  @ApiOkResponse({ description: 'Una fila por clasificación (elástica, inelástica, unitaria).' })
  getElasticidad() {
    return this.dashboardService.getElasticidad();
  }

  @Get('elasticidad/sensibles')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Productos más sensibles al precio (mayor |E|).' })
  @ApiQuery({ name: 'limit', required: false, description: 'Máximo de filas (default 10, máx 50).' })
  @ApiOkResponse({ description: 'Elasticidades ordenadas por valor absoluto descendente.' })
  getSensibles(@Query('limit', new ParseIntPipe({ optional: true })) limit?: number) {
    return this.dashboardService.getSensibles(limit ?? 10);
  }

  @Get('variacion-precios')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Variación porcentual entre precios consecutivos.' })
  @ApiQuery({ name: 'presentationId', required: false })
  @ApiQuery({ name: 'storeId', required: false })
  @ApiQuery({ name: 'limit', required: false, description: 'Máximo de filas (default 50, máx 200).' })
  @ApiOkResponse({ description: 'Precio actual, anterior y variación por pareja presentación/tienda.' })
  getVariacionPrecios(
    @Query('presentationId') presentationId?: string,
    @Query('storeId') storeId?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.dashboardService.getVariacionPrecios(presentationId, storeId, limit ?? 50);
  }

  @Get('accesibilidad')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Accesibilidad vigente por zona (última corrida completada).' })
  @ApiOkResponse({ description: 'Índice por zona con su corrida de origen.' })
  getAccesibilidad() {
    return this.dashboardService.getAccesibilidad();
  }

  @Get('accesibilidad/:zoneId')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Desglose del índice vigente: aporte de cada componente.' })
  @ApiOkResponse({ description: 'Precio, ingreso, disponibilidad y cobertura con peso y aporte.' })
  getAccesibilidadDesglose(@Param('zoneId', ParseUUIDPipe) zoneId: string) {
    return this.dashboardService.getAccesibilidadDesglose(zoneId);
  }

  @Get('simulacion')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Escenarios creados e impacto estimado en demanda, ingreso y accesibilidad.' })
  @ApiQuery({ name: 'zoneId', required: false })
  @ApiQuery({ name: 'indicador', required: false, description: 'Clave del indicador (ej. ingreso_estimado).' })
  @ApiOkResponse({ description: 'Valor base, simulado y variación por escenario e indicador.' })
  getSimulacion(@Query('zoneId') zoneId?: string, @Query('indicador') indicador?: string) {
    return this.dashboardService.getSimulacion(zoneId, indicador);
  }
}
