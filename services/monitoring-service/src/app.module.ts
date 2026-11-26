import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { MonitoringController } from './monitoring/monitoring.controller';
import { MonitoringService } from './monitoring/monitoring.service';
import { MonitoringStore } from './monitoring/monitoring.store';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({})],
  controllers: [HealthController, MonitoringController],
  providers: [SessionGuard, RolesGuard, MonitoringService, MonitoringStore],
})
export class AppModule {}
