import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SessionGuard } from '../common/auth/session.guard';
import { PriceAlertsModule } from '../price-alerts/price-alerts.module';
import { PricesModule } from '../prices/prices.module';
import { PriceObservationsController } from './price-observations.controller';
import { PriceObservationsService } from './price-observations.service';

/**
 * Precios observados en tienda (D-16). Dueño de la tabla `precios_observados`. Al aprobar reutiliza
 * `PricesService.registrarPrecio`, así el alta por observación cierra el precio vigente igual que el alta directa.
 */
@Module({
  imports: [JwtModule.register({}), PricesModule, PriceAlertsModule],
  controllers: [PriceObservationsController],
  providers: [PriceObservationsService, SessionGuard, AuditReporter],
})
export class PriceObservationsModule {}
