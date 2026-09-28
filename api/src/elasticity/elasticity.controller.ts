import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERFILES_INTERNOS, ROL, UsuarioSolicitante } from '../common/roles';
import { ElasticityService } from './elasticity.service';
import { ElasticityParamsDto } from './dto/elasticity-params.dto';
import { ElasticityFilterDto } from './dto/elasticity-filter.dto';
import { ElasticityResult } from './dto/elasticity-result.dto';
import { ElasticityChartData } from './dto/elasticity-chart-data.dto';

/**
 * M11 — Elasticidad precio-demanda. Calcular crea una corrida, así que
 * queda para Administrador y Analista (mismo criterio que M10); el
 * gráfico es lectura para cualquier perfil interno.
 */
@ApiTags('M11 Elasticity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('elasticity')
export class ElasticityController {
  constructor(private readonly elasticityService: ElasticityService) {}

  @Post('calculate')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({
    summary: 'Calcula y clasifica la elasticidad precio-demanda (por zona y nacional) y guarda la corrida.',
  })
  @ApiCreatedResponse({ type: ElasticityResult })
  calculate(@Body() params: ElasticityParamsDto, @CurrentUser() user: UsuarioSolicitante) {
    // El usuario sale del JWT, nunca del cuerpo: no se puede suplantar.
    return this.elasticityService.calculate(params, user);
  }

  @Get('chart')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Datos del gráfico comparativo de una presentación, por zona o por segmento.' })
  @ApiOkResponse({ type: ElasticityChartData })
  getComparativeChart(@Query() filters: ElasticityFilterDto) {
    return this.elasticityService.getComparativeChart(filters);
  }
}
