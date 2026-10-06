import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisRun } from '../entities/analysis-run.entity';
import { AnalysisRunAssumption } from '../entities/analysis-run-assumption.entity';
import { AnalysisRunFilter } from '../entities/analysis-run-filter.entity';
import { AnalysisRunParameter } from '../entities/analysis-run-parameter.entity';
import { AssociationExclusion } from '../entities/association-exclusion.entity';
import { AssociationRule } from '../entities/association-rule.entity';
import { AssociationRuleItem } from '../entities/association-rule-item.entity';
import { FuenteDatosModule } from '../fuente-datos/fuente-datos.module';
import { AssociationService } from './association.service';

/**
 * M10 — Reglas de asociación (Apriori), trasladado del monolito.
 *
 * Soporte y confianza configurables (RF-15); guarda la CORRIDA COMPLETA
 * (parámetros, fecha, usuario, dataset y resultados) para poder
 * reproducirla. Las canastas, productos y usuarios llegan por FuenteDatos.
 *
 * Se registran las 7 entidades y no solo 3 como en el monolito: con
 * `autoLoadEntities` TypeORM solo conoce las entidades listadas en algún
 * `forFeature`, y las relaciones de AnalysisRun y AssociationRule
 * necesitan a sus hijas registradas.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnalysisRun,
      AnalysisRunParameter,
      AnalysisRunAssumption,
      AnalysisRunFilter,
      AssociationRule,
      AssociationRuleItem,
      AssociationExclusion,
    ]),
    FuenteDatosModule,
  ],
  providers: [AssociationService],
  exports: [AssociationService],
})
export class AssociationModule {}
