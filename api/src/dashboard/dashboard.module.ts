import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ElasticityModule } from '../elasticity/elasticity.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * M16 — Dashboard de negocio (solo lectura).
 *
 * No tiene tablas propias: expone las vistas del §16 de schema.sql
 * (`v_dashboard_*`) y reutiliza los servicios que ya calculan cada
 * bloque (M09 AnalyticsService, M11 SubstitutionService). Si una corrida
 * no existe, el bloque devuelve vacío, nunca 500: un tablero no debe
 * romperse porque un análisis aún no se corrió.
 *
 * Importa AnalyticsModule y ElasticityModule (ambos exportan sus
 * servicios); no toca ningún otro módulo.
 */
@Module({
  imports: [AnalyticsModule, ElasticityModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
