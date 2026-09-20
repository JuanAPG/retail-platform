import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Basket } from '../entities/basket.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionDetail } from '../entities/transaction-detail.entity';
import { BasketsService } from './baskets.service';
import { BasketsController } from './baskets.controller';

/**
 * M07 — Baskets. Responsable: Fernando Olivares.
 * buildFromTransaction() la llama TransactionsModule (M06, Juan) al
 * crear una transacción — no hay endpoint POST porque no se construye
 * "a mano" según el Contrato de Métodos y Endpoints.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Basket, Transaction, TransactionDetail])],
  controllers: [BasketsController],
  providers: [BasketsService],
  exports: [BasketsService],
})
export class BasketsModule {}