import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERFILES_INTERNOS, ROL, UsuarioSolicitante } from '../common/roles';
import { AssociationService } from './association.service';
import { AprioriParamsDto } from './dto/apriori-params.dto';

/**
 * M10 — Reglas de asociación. Correr Apriori crea una corrida, así que
 * queda para Administrador y Analista (mismo criterio que M05 y M06);
 * consultar corridas es lectura para cualquier perfil interno.
 */
@ApiTags('M10 Association')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('association')
export class AssociationController {
  constructor(private readonly associationService: AssociationService) {}

  @Post('apriori/run')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({ summary: 'Corre Apriori con el soporte y la confianza dados y guarda la corrida.' })
  @ApiCreatedResponse({
    description: 'Reglas de la corrida (AssociationRule[]), cada una con su runId y sus productos.',
  })
  runApriori(@Body() params: AprioriParamsDto, @CurrentUser() user: UsuarioSolicitante) {
    // El usuario sale del JWT, nunca del cuerpo: no se puede suplantar.
    return this.associationService.runApriori(params, user);
  }

  @Get('runs')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Historial de corridas de Apriori, de la más reciente a la más antigua.' })
  @ApiOkResponse({ description: 'Corridas (AnalysisRun[]) con sus parámetros, sin reglas.' })
  findAllRuns() {
    return this.associationService.findAllRuns();
  }

  @Get('runs/:id')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Una corrida completa: parámetros, supuestos, filtros y reglas.' })
  @ApiOkResponse({ description: 'Corrida (AnalysisRun) con sus reglas en `results`.' })
  findRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.associationService.findRun(id);
  }
}
