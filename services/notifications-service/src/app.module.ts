import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { AuditReporter } from './common/audit/audit-reporter.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import {
  InMemoryNotificationsRepository,
  NOTIFICATIONS_REPOSITORY,
} from './notifications/in-memory.repository';

/**
 * notifications-service: notificaciones internas. Sin Mongo todavía: la
 * persistencia sale del puerto NOTIFICATIONS_REPOSITORY (hoy en memoria;
 * pendiente el adaptador Mongoose cuando documents-service fije el patrón).
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({}), ScheduleModule.forRoot()],
  controllers: [HealthController, NotificationsController],
  providers: [
    NotificationsService,
    AuditReporter,
    SessionGuard,
    { provide: NOTIFICATIONS_REPOSITORY, useClass: InMemoryNotificationsRepository },
  ],
  exports: [SessionGuard],
})
export class AppModule {}
