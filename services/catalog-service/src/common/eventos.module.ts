import { Global, Module } from '@nestjs/common';
import { AuditReporter } from './audit/audit-reporter.service';
import { AuditarInterceptor } from './audit/auditar.interceptor';
import { NotificarInterceptor } from './notifications/notificar.interceptor';
import { NotificationsReporter } from './notifications/notifications-reporter.service';

/**
 * Auditoría (audit-service) y notificaciones (notifications-service): salidas no bloqueantes
 * que comparten todos los módulos de negocio del catálogo.
 */
@Global()
@Module({
  providers: [AuditReporter, NotificationsReporter, AuditarInterceptor, NotificarInterceptor],
  exports: [AuditReporter, NotificationsReporter, AuditarInterceptor, NotificarInterceptor],
})
export class EventosModule {}
