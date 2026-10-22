import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionGuard } from '../common/auth/session.guard';
import { AlgorithmsModule } from '../common/algorithms/algorithms.module';
import { AuditModule } from '../common/audit/audit.module';
import { NotificationsModule } from '../common/notifications/notifications.module';
import { Recommendation } from '../entities/recommendation.entity';
import { RecommendationEvidence } from '../entities/recommendation-evidence.entity';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsController } from './recommendations.controller';

/**
 * M14 — Recomendaciones. Tres reglas leen vistas/tablas de Postgres
 * (v_dashboard_accesibilidad_zona, elasticidades, escenario_resultados) vía
 * DataSource. La cuarta, venta cruzada, pide las reglas de asociación a
 * algorithms-core por HTTP (AlgorithmsModule): sus corridas viven en
 * MongoDB (D3). Sin datos, cada regla solo devuelve menos recomendaciones;
 * con algorithms-core caído, `generate` responde 503.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Recommendation, RecommendationEvidence]),
    JwtModule.register({}),
    AuditModule,
    NotificationsModule,
    AlgorithmsModule,
  ],
  controllers: [RecommendationsController],
  providers: [RecommendationsService, SessionGuard],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}