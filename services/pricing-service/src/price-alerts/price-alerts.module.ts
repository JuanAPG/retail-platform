import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SessionGuard } from '../common/auth/session.guard';
import { PriceAlertsController } from './price-alerts.controller';
import { PriceAlertsService } from './price-alerts.service';

/** Alerta de cambio de precio (D-09). Dueño de la tabla `config_alertas_precio`. */
@Module({
  imports: [JwtModule.register({})],
  controllers: [PriceAlertsController],
  providers: [PriceAlertsService, SessionGuard, AuditReporter],
  exports: [PriceAlertsService],
})
export class PriceAlertsModule {}
