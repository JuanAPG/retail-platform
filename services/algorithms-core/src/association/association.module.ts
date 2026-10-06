import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionGuard } from '../common/auth/session.guard';
import { AnalysisRun } from '../entities/analysis-run.entity';
import { AnalysisRunAssumption } from '../entities/analysis-run-assumption.entity';
import { AnalysisRunFilter } from '../entities/analysis-run-filter.entity';
import { AnalysisRunParameter } from '../entities/analysis-run-parameter.entity';
import { AssociationExclusion } from '../entities/association-exclusion.entity';
import { AssociationRule } from '../entities/association-rule.entity';
import { AssociationRuleItem } from '../entities/association-rule-item.entity';
import { FuenteDatosModule } from '../fuente-datos/fuente-datos.module';
import { AssociationController } from './association.controller';
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
 *
 * JwtModule y SessionGuard van aquí (como en catalog-service): el guard
 * necesita JwtService y cada módulo solo ve lo que importa.
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
    JwtModule.register({}),
  ],
  controllers: [AssociationController],
  providers: [AssociationService, SessionGuard],
  exports: [AssociationService],
})
export class AssociationModule {}
