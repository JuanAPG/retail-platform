import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
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
    JwtModule.register({}),
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
