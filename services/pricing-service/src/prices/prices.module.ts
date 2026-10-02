import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SessionGuard } from '../common/auth/session.guard';
import { PriceHistory } from '../entities/price-history.entity';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';

/**
 * M08 — Precios. Histórico versionado por presentación y tienda (RN-06).
 * Solo escribe `precios`; presentaciones, tiendas y zonas (catalog-service)
 * se consultan por SQL.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PriceHistory]), JwtModule.register({})],
  controllers: [PricesController],
  providers: [PricesService, SessionGuard, AuditReporter],
  exports: [PricesService],
})
export class PricesModule {}
