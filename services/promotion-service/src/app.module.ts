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
import { Fuentes } from './promociones/fuentes';
import { PromocionesController } from './promociones/promociones.controller';
import { PromocionesService } from './promociones/promociones.service';
import { RepositorioPromociones } from './promociones/repositorio';

/**
 * promotion-service (puerto 3115, D-39). Contrato:
 * `docs/contratos/promotion-service.md` y `.xsd` (namespace `promotion/v1`).
 * PostgreSQL (sus dos tablas) y Redis (sesión). Lee catálogo y precios por
 * HTTP; nunca escribe tablas ajenas.
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
  controllers: [HealthController, PromocionesController],
  providers: [SessionGuard, RolesGuard, AvisosService, Fuentes, RepositorioPromociones, PromocionesService],
})
export class AppModule implements NestModule {
  /** Solo estas dos rutas aceptan cuerpo XML (tope de 1 MB → 413). */
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LeerCuerpoXmlMiddleware)
      .forRoutes(
        { path: 'promotions', method: RequestMethod.POST },
        { path: 'promotions/:id/reject', method: RequestMethod.PATCH },
      );
  }
}
