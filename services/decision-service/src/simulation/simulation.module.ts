import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionGuard } from '../common/auth/session.guard';
import { Scenario } from '../entities/scenario.entity';
import { ScenarioChange } from '../entities/scenario-change.entity';
import { ScenarioResult } from '../entities/scenario-result.entity';
import { SimulationService } from './simulation.service';
import { SimulationController } from './simulation.controller';

/**
 * M13 — Simulación de escenarios.
 *
 * Crear escenario, modificar precio o empaque, simular y comparar contra
 * el escenario base. Cada corrida se guarda con sus parámetros para que
 * la comparación sea reproducible. Lee precios/presentaciones/elasticidad
 * con SQL directo sobre tablas compartidas (no importa módulos de otros
 * servicios: ver nota en `SimulationService.findSegmentId`).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Scenario, ScenarioChange, ScenarioResult]), JwtModule.register({})],
  controllers: [SimulationController],
  providers: [SimulationService, SessionGuard],
})
export class SimulationModule {}