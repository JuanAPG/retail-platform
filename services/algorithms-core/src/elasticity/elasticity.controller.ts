import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, pagina, RespuestaXml } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
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
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({
    summary: 'Calcula y clasifica la elasticidad precio-demanda (por zona y nacional) y guarda la corrida.',
  })
  @RespuestaXml(
    201,
    'Elasticidades calculadas (zoneId nulo = nacional), combinaciones sin datos suficientes y supuestos.',
    muestras.calculoElasticidad,
    'elasticityCalculateResponse',
    { siemprePresentes: ['zoneId', 'rSquared'] },
  )
  @ApiErrores(400, 401, 403, 404, 500)
  calculate(@Body() params: ElasticityParamsDto, @CurrentUser() user: SesionUsuario) {
    // El usuario sale del JWT, nunca del cuerpo: no se puede suplantar.
    return this.elasticityService.calculate(params, user);
  }

  @Get('chart')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Datos del gráfico comparativo de una presentación, por zona o por segmento.' })
  @RespuestaXml(
    200,
    'Una barra por zona o segmento (vacía si no tuvo datos suficientes) y el agregado nacional.',
    muestras.graficoElasticidad,
    'elasticityChartResponse',
    { siemprePresentes: ['value', 'classification', 'rSquared', 'national'] },
  )
  @ApiErrores(400, 401, 403, 404)
  getComparativeChart(@Query() filters: ElasticityFilterDto) {
    return this.elasticityService.getComparativeChart(filters);
  }

  @Get('current')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Elasticidad vigente por presentación y zona (la de la corrida completada más reciente), para decision-service.',
  })
  @RespuestaXml(
    200,
    'Página de elasticidades vigentes; con zoneId incluye las nacionales (al final de cada presentación).',
    pagina(muestras.elasticidadesVigentes, 4),
    'currentElasticityListResponse',
    { siemprePresentes: ['zoneId', 'rSquared'] },
  )
  @ApiErrores(400, 401, 403)
  current(@Query() filtros: CurrentElasticityFilterDto) {
    return this.elasticityService.current(filtros);
  }
}
