import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionGuard } from '../common/auth/session.guard';
import { AuditModule } from '../common/audit/audit.module';
import { NotificationsModule } from '../common/notifications/notifications.module';
import { LeerCuerpoXmlMiddleware } from '../common/xml/cuerpo-xml';
import { Scenario } from '../entities/scenario.entity';
import { ScenarioChange } from '../entities/scenario-change.entity';
import { ScenarioResult } from '../entities/scenario-result.entity';
import { SimulationService } from './simulation.service';
import { SimulationController } from './simulation.controller';

/**
 * Rutas que aceptan cuerpo XML además de JSON (raíces `simulacionPrecioRequest`
 * y `simulacionPresentacionRequest` del XSD). Exportada para que las pruebas
 * monten exactamente el mismo registro.
 */
export function registrarCuerpoXml(consumer: MiddlewareConsumer): void {
  consumer
    .apply(LeerCuerpoXmlMiddleware)
    .forRoutes(
      { path: 'simulation/price', method: RequestMethod.POST },
      { path: 'simulation/presentation', method: RequestMethod.POST },
    );
}

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
  imports: [TypeOrmModule.forFeature([Scenario, ScenarioChange, ScenarioResult]), JwtModule.register({}), AuditModule, NotificationsModule],
  controllers: [SimulationController],
  providers: [SimulationService, SessionGuard],
})
export class SimulationModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    registrarCuerpoXml(consumer);
  }
}
