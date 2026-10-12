import { Module } from '@nestjs/common';
import { AuditReporter } from '../audit/audit-reporter.service';
import { NotificationsReporter } from '../notifications/notifications-reporter.service';
import { ReporteDeCorridas } from './reporte-de-corridas.service';

/** Bitácora y avisos de corridas (ALG-10); lo importan asociación y elasticidad. */
@Module({
  providers: [AuditReporter, NotificationsReporter, ReporteDeCorridas],
  exports: [ReporteDeCorridas],
})
export class ReportesModule {}
