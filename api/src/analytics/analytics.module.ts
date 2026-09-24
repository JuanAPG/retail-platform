import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Basket } from '../entities/basket.entity';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * M09 — Analítica descriptiva.
 *
 * Responsable: Leonardo Rangel
 * Rama:        `feature/m09-analitica`
 *
 * Alcance:
 * - Indicadores descriptivos por zona, segmento y categoría a partir de las
 *   canastas de M07. Es la base de comparación del resto del análisis.
 *
 * Exporta AnalyticsService para que Accesibilidad (M12) y
 * Recomendaciones (M14) consuman los indicadores sin recalcularlos.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Basket])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
