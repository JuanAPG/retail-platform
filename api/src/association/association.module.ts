import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisRun } from '../entities/analysis-run.entity';
import { AssociationRule } from '../entities/association-rule.entity';
import { AssociationExclusion } from '../entities/association-exclusion.entity';
import { AssociationController } from './association.controller';
import { AssociationService } from './association.service';

/**
 * M10 — Reglas de asociación (Apriori).
 *
 * Responsable: Leonardo Rangel
 * Rama:        `feature/m10-asociacion`
 *
 * Alcance:
 * - Soporte y confianza configurables (RF-15). Debe guardar la CORRIDA
 *   COMPLETA — parámetros, fecha, usuario, dataset y resultados — no solo
 *   el resultado final, para poder reproducirla después. Consume M07.
 *
 * Exporta AssociationService para que Sustitución (M11) y
 * Recomendaciones (M14) consuman las reglas sin recalcularlas.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AnalysisRun, AssociationRule, AssociationExclusion])],
  controllers: [AssociationController],
  providers: [AssociationService],
  exports: [AssociationService],
})
export class AssociationModule {}
