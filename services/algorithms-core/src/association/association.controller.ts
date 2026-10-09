import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { ApiErrores, pagina, RespuestaXml } from '../common/swagger/ejemplos';
import { muestras } from '../common/swagger/muestras';
import { AssociationService } from './association.service';
import { AprioriParamsDto } from './dto/apriori-params.dto';

/**
 * M10 — Reglas de asociación. Correr Apriori crea una corrida, así que
 * queda para Administrador y Analista (mismo criterio que M05 y M06);
 * consultar corridas es lectura para cualquier perfil interno.
 * SessionGuard va primero: valida JWT + sesión en Redis y deja `request.user`.
 */
@ApiTags('M10 Association')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('association')
export class AssociationController {
  constructor(private readonly associationService: AssociationService) {}

  @Post('apriori/run')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({
    summary: 'Corre Apriori con el soporte y la confianza dados y guarda la corrida (Administrador, Analista comercial).',
  })
  @RespuestaXml(
    201,
    'Reglas de la corrida, cada una con su runId y sus productos (antecedente como conjunto).',
    muestras.reglas,
    'aprioriRunResponse',
    { siemprePresentes: ['lift', 'transactionCount'] },
  )
  @ApiErrores(400, 401, 403, 500, 503)
  runApriori(@Body() params: AprioriParamsDto, @CurrentUser() user: SesionUsuario) {
    // El usuario sale del JWT, nunca del cuerpo: no se puede suplantar.
    return this.associationService.runApriori(params, user);
  }

  @Get('runs')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Historial de corridas de Apriori, de la más reciente a la más antigua (paginado).' })
  @RespuestaXml(200, 'Página de corridas con sus parámetros, sin reglas.', pagina([muestras.corrida], 5), 'runListResponse', {
    siemprePresentes: ['userId', 'user', 'transactionsConsidered', 'basketsConsidered', 'errorMessage'],
  })
  @ApiErrores(400, 401, 403, 503)
  findAllRuns(@Query() paginacion: PaginationDto) {
    return this.associationService.findAllRuns(paginacion);
  }

  @Get('runs/:id')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Una corrida completa: parámetros, supuestos, filtros y reglas.' })
  @RespuestaXml(200, 'La corrida con sus supuestos, filtros y reglas en `results`.', muestras.corridaCompleta, 'runResponse', {
    siemprePresentes: ['userId', 'user', 'transactionsConsidered', 'basketsConsidered', 'errorMessage', 'lift', 'transactionCount'],
  })
  @ApiErrores(400, 401, 403, 404, 503)
  findRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.associationService.findRun(id);
  }
}
