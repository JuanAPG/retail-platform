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
import { CONFIG_DESTINO, DESTINO_CAPTURAS, DestinoCapturas } from './sync/destinos/destino';
import { ConfigDestino, configDestino, DestinoHttp } from './sync/destinos/destino-http';
import { DestinoSimulado } from './sync/destinos/destino-simulado';
import { SyncController } from './sync/sync.controller';
import { SyncService } from './sync/sync.service';
import { CuerpoLoteMiddleware } from './sync/xml/cuerpo-lote.middleware';
import { ValidadorXsd } from './sync/xml/validador-xsd';

/**
 * offline-sync-service (T-17). Lotes y acuses en MongoDB, idempotencia y
 * último estado en Redis (D-47). Los destinos entran por el puerto
 * `DESTINO_CAPTURAS` y se eligen con `SYNC_DESTINO` (contrato §6):
 *  - `http` (por defecto): `DestinoHttp`, a availability-service y
 *    pricing-service. Sin `AVAILABILITY_SERVICE_URL` o `PRICING_SERVICE_URL`
 *    el servicio NO arranca y dice cuál falta.
 *  - `simulado`: `DestinoSimulado` en memoria (pruebas y demo sin destinos).
 */
function crearDestino(config: ConfigDestino): DestinoCapturas {
  if (config.modo === 'simulado') return new DestinoSimulado();
  return new DestinoHttp({ availabilityUrl: config.availabilityUrl as string, pricingUrl: config.pricingUrl as string });
}

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
    // Se valida al arrancar: un SYNC_DESTINO inválido o una URL faltante detienen el servicio.
    { provide: CONFIG_DESTINO, useFactory: () => configDestino() },
    { provide: DESTINO_CAPTURAS, useFactory: crearDestino, inject: [CONFIG_DESTINO] },
  ],
  exports: [SessionGuard],
})
export class AppModule implements NestModule {
  /** Solo `POST /v1/sync/batches` lleva cuerpo (JSON o XML, máximo 1 MB). */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CuerpoLoteMiddleware).forRoutes({ path: 'sync/batches', method: RequestMethod.POST });
  }
}
