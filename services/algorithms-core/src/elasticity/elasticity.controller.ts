import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { CurrentElasticityFilterDto } from './dto/current-elasticity.dto';
import { ElasticityFilterDto } from './dto/elasticity-filter.dto';
import { ElasticityParamsDto } from './dto/elasticity-params.dto';
import { ElasticityService } from './elasticity.service';

/**
 * M11 — Elasticidad precio-demanda. Calcular crea una corrida, así que
 * queda para Administrador y Analista (mismo criterio que M10); el
 * gráfico y la elasticidad vigente son lectura para cualquier perfil interno.
 * SessionGuard va primero: valida JWT + sesión en Redis y deja `request.user`.
 */
@ApiTags('M11 Elasticity')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('elasticity')
export class ElasticityController {
  constructor(private readonly elasticityService: ElasticityService) {}

  @Post('calculate')
  @XmlRoot('elasticityCalculateResponse', { siemprePresentes: ['zoneId', 'rSquared'] })
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({
    summary: 'Calcula y clasifica la elasticidad precio-demanda (por zona y nacional) y guarda la corrida.',
  })
  calculate(@Body() params: ElasticityParamsDto, @CurrentUser() user: SesionUsuario) {
    // El usuario sale del JWT, nunca del cuerpo: no se puede suplantar.
    return this.elasticityService.calculate(params, user);
  }

  @Get('chart')
  @XmlRoot('elasticityChartResponse', { siemprePresentes: ['value', 'classification', 'rSquared', 'national'] })
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Datos del gráfico comparativo de una presentación, por zona o por segmento.' })
  getComparativeChart(@Query() filters: ElasticityFilterDto) {
    return this.elasticityService.getComparativeChart(filters);
  }

  @Get('current')
  @XmlRoot('currentElasticityListResponse', { siemprePresentes: ['zoneId', 'rSquared'] })
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Elasticidad vigente por presentación y zona (la de la corrida completada más reciente), para decision-service.',
  })
  current(@Query() filtros: CurrentElasticityFilterDto) {
    return this.elasticityService.current(filtros);
  }
}
