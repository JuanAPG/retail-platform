import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AvisosService } from './common/avisos/avisos.service';
import { SessionGuard } from './common/auth/session.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HealthController } from './health/health.controller';
import {
  CierreDeConexiones,
  crearClienteMongo,
  MONGO_CLIENT,
  MongoRepositorioSync,
} from './sync/almacen/mongo.repositorio';
import { ALMACEN_RAPIDO, REPOSITORIO_SYNC } from './sync/almacen/puertos';
import { RedisAlmacen } from './sync/almacen/redis.almacen';
import { DESTINO_CAPTURAS } from './sync/destinos/destino';
import { DestinoSimulado } from './sync/destinos/destino-simulado';
import { SyncController } from './sync/sync.controller';
import { SyncService } from './sync/sync.service';
import { CuerpoLoteMiddleware } from './sync/xml/cuerpo-lote.middleware';
import { ValidadorXsd } from './sync/xml/validador-xsd';

/**
 * offline-sync-service (T-17). Lotes y acuses en MongoDB, idempotencia y
 * último estado en Redis (D-47). Los destinos entran por el puerto
 * `DESTINO_CAPTURAS`; hoy solo existe `DestinoSimulado` porque el mapeo real
 * está PENDIENTE de acuerdo con Pamela (contrato §6).
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({})],
  controllers: [HealthController, SyncController],
  providers: [
    SessionGuard,
    RolesGuard,
    AvisosService,
    SyncService,
    ValidadorXsd,
    CuerpoLoteMiddleware,
    { provide: MONGO_CLIENT, useFactory: crearClienteMongo },
    CierreDeConexiones,
    { provide: REPOSITORIO_SYNC, useClass: MongoRepositorioSync },
    { provide: ALMACEN_RAPIDO, useClass: RedisAlmacen },
    { provide: DESTINO_CAPTURAS, useClass: DestinoSimulado },
  ],
  exports: [SessionGuard],
})
export class AppModule implements NestModule {
  /** Solo `POST /v1/sync/batches` lleva cuerpo (JSON o XML, máximo 1 MB). */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CuerpoLoteMiddleware).forRoutes({ path: 'sync/batches', method: RequestMethod.POST });
  }
}
