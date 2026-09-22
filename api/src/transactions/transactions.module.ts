import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../entities/transaction.entity';
import { TransactionDetail } from '../entities/transaction-detail.entity';
import { Importacion } from '../entities/importacion.entity';
import { ImportacionFila } from '../entities/importacion-fila.entity';
import { ImportacionError } from '../entities/importacion-error.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { BasketsModule } from '../baskets/baskets.module';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';

/**
 * M06 — Transacciones e importación CSV.
 *
 * Responsable: Juan Angel Galván
 * Rama:        `feature/m06-transacciones`
 *
 * Alcance:
 * - Carga masiva por CSV con validación previa: ninguna fila inválida debe
 *   llegar a la base. Una transacción tiene tienda, fecha, total y
 *   detalles[] (producto, presentación, cantidad, precio_unitario,
 *   subtotal). Es el primer eslabón de la cadena: sin esto, M07 en
 *   adelante no tienen datos. Depende de las presentaciones de M04.
 * - Importa `BasketsModule` para construir la canasta justo después de
 *   guardar cada transacción (manual o confirmada del CSV).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Transaction,
      TransactionDetail,
      Importacion,
      ImportacionFila,
      ImportacionError,
      TiendaEntity,
      ProductoPresentacionEntity,
      ProductoEntity,
    ]),
    BasketsModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
