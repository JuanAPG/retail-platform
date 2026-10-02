import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { PricesModule } from './prices/prices.module';

/**
 * pricing-service: histórico versionado de precios por presentación y
 * tienda, y comparación entre zonas (M08). Lo transversal (filtros,
 * interceptores, SessionGuard) viene de la plantilla y no se modifica;
 * aquí solo se agregan módulos de negocio.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    JwtModule.register({}),
    PricesModule,
  ],
  controllers: [HealthController],
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AppModule {}
