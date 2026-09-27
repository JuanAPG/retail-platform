import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recommendation } from '../entities/recommendation.entity';
import { RecommendationEvidence } from '../entities/recommendation-evidence.entity';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsController } from './recommendations.controller';

/**
 * M14 — Recomendaciones. No importa ZonesModule ni ningún otro módulo:
 * las 4 reglas leen directo de las vistas/tablas ya existentes
 * (v_dashboard_accesibilidad_zona, elasticidades, escenario_resultados,
 * v_dashboard_asociaciones) vía DataSource, sin depender de servicios de
 * otros compañeros. Por eso M14 no está bloqueado por M09/M10 en curso:
 * solo puede devolver menos recomendaciones si esas tablas están vacías.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Recommendation, RecommendationEvidence])],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
