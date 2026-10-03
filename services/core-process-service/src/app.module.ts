import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';
import { Basket } from './entities/basket.entity';

/**
 * core-process-service: proceso principal (transacciones + canastas) más
 * M09 analítica descriptiva, que agrega sobre esos mismos datos.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    TypeOrmModule.forFeature([Basket]),
    JwtModule.register({}),
  ],
  controllers: [HealthController, AnalyticsController],
  providers: [AnalyticsService, SessionGuard],
  exports: [SessionGuard],
})
export class AppModule {}
