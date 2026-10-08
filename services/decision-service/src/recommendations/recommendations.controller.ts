import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../common/auth/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { XmlRoot } from '../common/decorators/xml-root.decorator';
import { PERFILES_INTERNOS, ROL } from '../common/roles';
import { RecommendationsService } from './recommendations.service';
import { RecommendationContextDto } from './dto/recommendation-context.dto';
import { RecommendationExplanation } from './dto/recommendation-explanation.dto';
import { Recommendation } from '../entities/recommendation.entity';

/**
 * M14 — Motor de reglas de recomendaciones (sin IA). `evaluateRules` es un
 * método interno (sin endpoint propio): `generate` lo llama y persiste
 * las recomendaciones en una sola transacción. El contrato solo expone
 * `generate` y `explain`. Mismo criterio de roles que M11/M13:
 * Administrador y Analista para lo que calcula/guarda, cualquier perfil
 * interno para consultar.
 */
@ApiTags('M14 Recommendations')
@ApiBearerAuth()
@UseGuards(SessionGuard, RolesGuard)
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  @Post('generate')
  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  @ApiOperation({
    summary: 'Evalúa las 4 reglas (accesibilidad, elasticidad, simulación, asociación) y guarda las recomendaciones generadas.',
  })
  @ApiCreatedResponse({ type: [Recommendation] })
  generate(@Body() dto: RecommendationContextDto) {
    return this.recommendationsService.generate(dto);
  }

  @Get(':id/explain')
  @XmlRoot('recomendacion')
  @Roles(...PERFILES_INTERNOS)
  @ApiOperation({ summary: 'Explica una recomendación ya generada: qué recomienda, por qué y con qué evidencia.' })
  @ApiOkResponse({ type: RecommendationExplanation })
  explain(
    @Param(
      'id',
      // El mensaje va en arreglo, como los del ValidationPipe: así el filtro
      // común lo pasa a `details` y el 400 sale con la misma forma.
      new ParseUUIDPipe({
        exceptionFactory: () => new BadRequestException(['id debe ser un UUID válido.']),
      }),
    )
    id: string,
  ): Promise<RecommendationExplanation> {
    return this.recommendationsService.explain(id);
  }
}
