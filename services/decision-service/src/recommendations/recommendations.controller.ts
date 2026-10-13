import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard, SesionUsuario } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { RecommendationsService } from './recommendations.service';
import {
  RecommendationContextDto,
  RecommendationQueryDto,
  RejectRecommendationDto,
} from './dto/recommendation-context.dto';
import { RecommendationExplanation, RecommendationPage } from './dto/recommendation-explanation.dto';
import { Recommendation } from '../entities/recommendation.entity';

/**
 * El mensaje va en arreglo, como los del ValidationPipe: así el filtro
 * común lo pasa a `details` y el 400 sale con la misma forma.
 */
function idDeRecomendacion() {
  return new ParseUUIDPipe({
    exceptionFactory: () => new BadRequestException(['id debe ser un UUID válido.']),
  });
}

/**
 * M14 — Motor de reglas de recomendaciones (sin IA). `evaluateRules` es un
 * método interno (sin endpoint propio): `generate` lo llama y persiste
 * las recomendaciones en una sola transacción. Roles según la matriz de
 * permisos (M14) y D-12 ("genera el Planeador, decide el Gerente"): solo
 * el Planeador genera, solo el Gerente de categoría aprueba/rechaza;
 * Administrador, Analista y el resto de perfiles internos consultan (L).
 */
@ApiTags('M14 Recommendations')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Get()
  @XmlRoot('recomendacionesPageResponse')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Lista paginada de recomendaciones (recientes primero), filtrable por zona y estatus.' })
  @ApiOkResponse({ type: RecommendationPage })
  list(@Query() filtros: RecommendationQueryDto) {
    return this.recommendationsService.list(filtros);
  }

  @Post('generate')
  @XmlRoot('recomendacionesResponse')
  @Roles(ROL.PLANEADOR)
  @ApiOperation({
    summary:
      'Evalúa las 4 reglas (accesibilidad, elasticidad, simulación, asociación) y guarda las recomendaciones generadas, ' +
      'reemplazando las propuestas pendientes del mismo alcance (las aceptadas/descartadas se conservan).',
  })
  @ApiCreatedResponse({ type: [Recommendation] })
  generate(
    @Body() dto: RecommendationContextDto,
    @Headers('authorization') token: string | undefined,
    @Ip() ip: string,
  ) {
    // El token y la IP van a la bitácora (audit-service exige sesión).
    return this.recommendationsService.generate(dto, { token, ip });
  }

  @Get(':id/explain')
  @XmlRoot('recomendacion')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Explica una recomendación ya generada: qué recomienda, por qué y con qué evidencia.' })
  @ApiOkResponse({ type: RecommendationExplanation })
  explain(@Param('id', idDeRecomendacion()) id: string): Promise<RecommendationExplanation> {
    return this.recommendationsService.explain(id);
  }

  @Patch(':id/approve')
  @XmlRoot('recomendacion')
  @Roles(ROL.GERENTE_CATEGORIA)
  @ApiOperation({ summary: "Aprueba una recomendación en 'propuesta' (pasa a 'aceptada'). 409 si ya fue decidida." })
  @ApiOkResponse({ type: RecommendationExplanation })
  approve(
    @Param('id', idDeRecomendacion()) id: string,
    @CurrentUser() user: SesionUsuario,
    @Headers('authorization') token: string | undefined,
    @Ip() ip: string,
  ): Promise<RecommendationExplanation> {
    return this.recommendationsService.approve(id, user, { token, ip });
  }

  @Patch(':id/reject')
  @XmlRoot('recomendacion')
  @Roles(ROL.GERENTE_CATEGORIA)
  @ApiOperation({
    summary: "Rechaza una recomendación en 'propuesta' (pasa a 'descartada'); exige motivo de 10 a 500 caracteres. 409 si ya fue decidida.",
  })
  @ApiOkResponse({ type: RecommendationExplanation })
  reject(
    @Param('id', idDeRecomendacion()) id: string,
    @Body() dto: RejectRecommendationDto,
    @CurrentUser() user: SesionUsuario,
    @Headers('authorization') token: string | undefined,
    @Ip() ip: string,
  ): Promise<RecommendationExplanation> {
    return this.recommendationsService.reject(id, dto.motivo, user, { token, ip });
  }
}
