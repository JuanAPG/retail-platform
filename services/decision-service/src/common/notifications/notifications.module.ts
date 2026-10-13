import { Module } from '@nestjs/common';
import { NotificationsReporter } from './notifications-reporter.service';

/** Avisos a notifications-service (D-12); lo importan simulación y recomendaciones. */
@Module({
  providers: [NotificationsReporter],
  exports: [NotificationsReporter],
})
export class NotificationsModule {}
