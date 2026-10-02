import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionGuard } from '../common/auth/session.guard';
import { Recommendation } from '../entities/recommendation.entity';
import { RecommendationEvidence } from '../entities/recommendation-evidence.entity';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsController } from './recommendations.controller';

/**
 * M14 — Recomendaciones. No importa ningún otro módulo de negocio: las 4
 * reglas leen directo de las vistas/tablas ya existentes
 * (v_dashboard_accesibilidad_zona, elasticidades, escenario_resultados,
 * v_dashboard_asociaciones) vía DataSource, sin depender de servicios de
 * otros compañeros. Por eso no está bloqueado por lo que corran M09/M10
 * en otro servicio: solo puede devolver menos recomendaciones si esas
 * tablas están vacías.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Recommendation, RecommendationEvidence]), JwtModule.register({})],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, SessionGuard],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}