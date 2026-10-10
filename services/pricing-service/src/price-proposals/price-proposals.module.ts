import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SessionGuard } from '../common/auth/session.guard';
import { PriceProposal } from '../entities/price-proposal.entity';
import { PriceAlertsModule } from '../price-alerts/price-alerts.module';
import { PricesModule } from '../prices/prices.module';
import { PriceProposalsController } from './price-proposals.controller';
import { PriceProposalsService } from './price-proposals.service';

/**
 * Propuestas de precio del Proveedor (RN-14). Al aprobar, reutiliza
 * `PricesService.registrarPrecio` para que el alta por propuesta y el alta
 * directa cierren el precio vigente exactamente igual.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PriceProposal]), JwtModule.register({}), PricesModule, PriceAlertsModule],
  controllers: [PriceProposalsController],
  providers: [PriceProposalsService, SessionGuard, AuditReporter],
})
export class PriceProposalsModule {}
