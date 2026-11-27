import { Module } from '@nestjs/common';
import { AuditReporter } from '../audit/audit-reporter.service';
import { LineageReporter } from '../linaje/lineage-reporter.service';
import { NotificationsReporter } from '../notifications/notifications-reporter.service';
import { ReporteDeCorridas } from './reporte-de-corridas.service';

/** Bitácora, avisos (ALG-10) y linaje (D-43) de corridas; lo importan asociación y elasticidad. */
@Module({
  providers: [AuditReporter, NotificationsReporter, LineageReporter, ReporteDeCorridas],
  exports: [ReporteDeCorridas],
})
export class ReportesModule {}
