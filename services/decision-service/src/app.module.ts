import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { AccessibilityModule } from './accessibility/accessibility.module';
import { SimulationModule } from './simulation/simulation.module';
import { RecommendationsModule } from './recommendations/recommendations.module';

/**
 * decision-service: combina M12 Accessibility + M13 Simulation + M14
 * Recommendations. Lo transversal (filtros, interceptores, SessionGuard)
 * viene de la plantilla y no se modifica; aquí solo se agregan módulos
 * de negocio.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    JwtModule.register({}),
    AccessibilityModule,
    SimulationModule,
    RecommendationsModule,
  ],
  controllers: [HealthController],
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AppModule {}
