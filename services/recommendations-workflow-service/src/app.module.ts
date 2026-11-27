import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AvisosService } from './common/avisos/avisos.service';
import { SessionGuard } from './common/auth/session.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { LeerCuerpoXmlMiddleware } from './common/xml/cuerpo-xml';
import databaseConfig from './config/database.config';
import { HealthController } from './health/health.controller';
import { DecisionCliente } from './seguimiento/decision';
import { RepositorioSeguimientos } from './seguimiento/repositorio';
import { SeguimientoController } from './seguimiento/seguimiento.controller';
import { SeguimientoService } from './seguimiento/seguimiento.service';

/**
 * recommendations-workflow-service (puerto 3117, D-41). Contrato:
 * `docs/contratos/recommendations-workflow-service.md` y `.xsd` (namespace
 * `workflow/v1`). PostgreSQL (sus dos tablas) y Redis (sesión). Verifica las
 * recomendaciones por HTTP en decision-service; nunca lee ni escribe sus tablas.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    JwtModule.register({}),
  ],
  controllers: [HealthController, SeguimientoController],
  providers: [SessionGuard, RolesGuard, AvisosService, DecisionCliente, RepositorioSeguimientos, SeguimientoService],
})
export class AppModule implements NestModule {
  /** Solo estas tres rutas aceptan cuerpo XML (tope de 1 MB → 413). */
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LeerCuerpoXmlMiddleware)
      .forRoutes(
        { path: 'workflow/assignments', method: RequestMethod.POST },
        { path: 'workflow/assignments/:id/implement', method: RequestMethod.PATCH },
        { path: 'workflow/assignments/:id/evaluate', method: RequestMethod.PATCH },
      );
  }
}
