import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Scenario } from '../entities/scenario.entity';
import { ScenarioChange } from '../entities/scenario-change.entity';
import { ScenarioResult } from '../entities/scenario-result.entity';
import { ZonesModule } from '../zones/zones.module';
import { SimulationService } from './simulation.service';
import { SimulationController } from './simulation.controller';

/**
 * M13 — Simulación de escenarios.
 *
 * Responsable: Fernando Olivares
 * Rama:        `feature/m13-simulacion`
 *
 * Alcance:
 * - Crear escenario, modificar precio o empaque, simular y comparar
 *   contra el escenario base. Cada corrida se guarda con sus parámetros
 *   para que la comparación sea reproducible. Consume M08 (precios), M11
 *   (ElasticityService, vía tabla `elasticidades`) y M04 (presentaciones).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Scenario, ScenarioChange, ScenarioResult]), ZonesModule],
  controllers: [SimulationController],
  providers: [SimulationService],
})
export class SimulationModule {}
