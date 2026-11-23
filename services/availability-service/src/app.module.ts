import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { AuditReporter } from './common/audit/audit-reporter.service';
import { ServiciosExternos } from './common/http/servicios-externos.service';
import { AvailabilityController } from './availability/availability.controller';
import { CapturesService } from './availability/captures.service';
import { CoverageService } from './availability/coverage.service';

/**
 * availability-service (D-38): existencias por tienda y presentación,
 * capturas de campo, cobertura de la canasta básica y faltantes. Lo
 * transversal (filtros, interceptores, SessionGuard, correlación, health)
 * viene de la plantilla y no se modifica.
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
  controllers: [HealthController, AvailabilityController],
  providers: [SessionGuard, AuditReporter, ServiciosExternos, CapturesService, CoverageService],
})
export class AppModule {}
