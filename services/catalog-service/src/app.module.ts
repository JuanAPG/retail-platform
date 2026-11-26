import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { conexionTolerante, OPCIONES_MONGO, uriMongo } from './common/mongo/asegurar-mongo';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { EventosModule } from './common/eventos.module';
import { FieldVisitsModule } from './field-visits/field-visits.module';
import { SegmentsModule } from './segments/segments.module';
import { ProductsModule } from './products/products.module';
import { StoresModule } from './stores/stores.module';
import { ZonesModule } from './zones/zones.module';

/**
 * catalog-service: tiendas, zonas, productos/presentaciones y segmentos
 * (M02–M05). Lo transversal (filtros, interceptores, SessionGuard) viene
 * de la plantilla y no se modifica; aquí solo se agregan módulos de negocio.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    // D-30: visitas de campo en MongoDB (`visitas_campo`). `lazyConnection`: con Mongo caído o sin MONGO_URL el
    // servicio arranca igual, el health sale `degraded` y solo POST /v1/field-visits responde 503 (D-25).
    // La reconexión la hace asegurarMongo() bajo demanda.
    MongooseModule.forRoot(uriMongo(), { ...OPCIONES_MONGO, lazyConnection: true, connectionFactory: conexionTolerante }),
    JwtModule.register({}),
    EventosModule,
    FieldVisitsModule,
    SegmentsModule,
    ZonesModule,
    StoresModule,
    ProductsModule,
  ],
  controllers: [HealthController],
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AppModule {}
