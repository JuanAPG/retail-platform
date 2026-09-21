import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PriceHistory } from '../entities/price-history.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';

/**
 * M08 — Precios. Responsable: Pamela Rodríguez.
 * Rama: `feature/m08-precios`
 *
 * Histórico versionado de precios por presentación y tienda (RN-06).
 * Necesita `ProductoPresentacionEntity` para resolver productId->
 * presentaciones y `TiendaEntity` para resolver la zona de cada precio.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PriceHistory, ProductoPresentacionEntity, TiendaEntity]),
  ],
  controllers: [PricesController],
  providers: [PricesService],
  exports: [PricesService],
})
export class PricesModule {}
