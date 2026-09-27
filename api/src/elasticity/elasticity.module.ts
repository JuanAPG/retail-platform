import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisRun } from '../entities/analysis-run.entity';
import { Elasticity } from '../entities/elasticity.entity';
import { ZonesModule } from '../zones/zones.module';
import { ElasticityService } from './elasticity.service';

/**
 * M11 — Elasticidad y patrones de sustitución.
 *
 * Responsable: Leonardo Rangel
 * Rama:        `feature/m11-elasticidad`
 *
 * Alcance:
 * - Clasifica cada resultado como elástica (|E| > 1), inelástica (|E| < 1)
 *   o unitaria (|E| ≈ 1), y conserva los datos usados, el periodo y los
 *   supuestos. Necesita el histórico de precios de M08.
 *
 * Exporta ElasticityService para que Simulación (M13) estime la demanda
 * ante un cambio de precio con las elasticidades ya calculadas.
 */
@Module({
  // ZonesModule: zona → segmento para el gráfico por segmento.
  imports: [TypeOrmModule.forFeature([AnalysisRun, Elasticity]), ZonesModule],
  providers: [ElasticityService],
  exports: [ElasticityService],
})
export class ElasticityModule {}
