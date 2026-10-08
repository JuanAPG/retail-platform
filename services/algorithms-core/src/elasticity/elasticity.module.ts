import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisRun } from '../entities/analysis-run.entity';
import { AnalysisRunAssumption } from '../entities/analysis-run-assumption.entity';
import { AnalysisRunFilter } from '../entities/analysis-run-filter.entity';
import { AnalysisRunParameter } from '../entities/analysis-run-parameter.entity';
import { AssociationRule } from '../entities/association-rule.entity';
import { AssociationRuleItem } from '../entities/association-rule-item.entity';
import { Elasticity } from '../entities/elasticity.entity';
import { FuenteDatosModule } from '../fuente-datos/fuente-datos.module';
import { ElasticityService } from './elasticity.service';

/**
 * M11 — Elasticidad precio-demanda, trasladado del monolito, más
 * `current` (elasticidad vigente) para decision-service.
 *
 * Las corridas de elasticidad siguen en Postgres (D3 solo manda a Mongo
 * las de Apriori, FP-Growth y clustering) y decision-service lee
 * `elasticidades` directo. Se registran también las entidades que
 * AnalysisRun necesita para sus relaciones (`autoLoadEntities` solo conoce
 * las listadas en algún `forFeature`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Elasticity,
      AnalysisRun,
      AnalysisRunParameter,
      AnalysisRunAssumption,
      AnalysisRunFilter,
      AssociationRule,
      AssociationRuleItem,
    ]),
    FuenteDatosModule,
  ],
  providers: [ElasticityService],
  exports: [ElasticityService],
})
export class ElasticityModule {}
