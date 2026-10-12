import { Body, Controller, Get, Headers, Ip, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
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
 * M10 — Reglas de asociación. Según la Matriz (§3, M10), solo el Analista
 * comercial tiene Total: es el único que corre Apriori o FP-Growth (crea
 * una corrida; los dos son el mismo módulo).
 * El Administrador y los demás perfiles internos tienen Lectura: consultan
 * las corridas.
 * SessionGuard va primero: valida JWT + sesión en Redis y deja `request.user`.
 */
@ApiTags('M10 Association')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('association')
export class AssociationController {
  constructor(private readonly associationService: AssociationService) {}

  @Post('apriori/run')
  @Roles(ROL.ANALISTA)
  @ApiOperation({
    summary: 'Corre Apriori con el soporte y la confianza dados y guarda la corrida. Solo Analista comercial.',
  })
  @RespuestaXml(
    201,
    'Reglas de la corrida, cada una con su runId y sus productos (antecedente como conjunto).',
    muestras.reglas,
    'aprioriRunResponse',
    { siemprePresentes: ['lift', 'transactionCount'] },
  )
  @ApiErrores(400, 401, 403, 500, 503)
  runApriori(
    @Body() params: AprioriParamsDto,
    @CurrentUser() user: SesionUsuario,
    @Headers('authorization') token: string | undefined,
    @Ip() ip: string,
  ) {
    // El usuario sale del JWT, nunca del cuerpo: no se puede suplantar. El
    // token y la IP van a la bitácora y al aviso de la corrida (ALG-10).
    return this.associationService.runApriori(params, user, { token, ip });
  }

  @Post('fpgrowth/run')
  @Roles(ROL.ANALISTA)
  @ApiOperation({
    summary: 'Corre FP-Growth con el soporte y la confianza dados y guarda la corrida. Solo Analista comercial.',
    description:
      'Mismo cuerpo y misma respuesta que apriori/run: con los mismos datos y umbrales da las mismas reglas en ' +
      'el mismo orden (RF-14). La corrida guarda `algoritmo = fpgrowth` en sus parámetros (D2).',
  })
  @RespuestaXml(
    201,
    'Reglas de la corrida, cada una con su runId y sus productos (antecedente como conjunto).',
    muestras.reglas,
    'fpgrowthRunResponse',
    { siemprePresentes: ['lift', 'transactionCount'] },
  )
  @ApiErrores(400, 401, 403, 500, 503)
  runFpGrowth(
    @Body() params: AprioriParamsDto,
    @CurrentUser() user: SesionUsuario,
    @Headers('authorization') token: string | undefined,
    @Ip() ip: string,
  ) {
    return this.associationService.runFpGrowth(params, user, { token, ip });
  }

  @Get('runs')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({
    summary: 'Historial de corridas de Apriori y FP-Growth, de la más reciente a la más antigua (paginado).',
    description: 'El parámetro `algoritmo` de cada corrida dice con cuál corrió: `apriori` o `fpgrowth` (D2).',
  })
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
