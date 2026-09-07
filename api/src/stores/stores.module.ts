import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TiendaEntity } from '../entities/tienda.entity';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

/**
 * M02 — Tiendas. Responsable: Pamela Rodríguez.
 * Rama: `feature/m02-tiendas`
 *
 * Hoy solo expone la lectura que ya consumían los portales. Pendiente:
 * alta/edición/baja de tiendas y su asociación a zona (RF-05, RF-06).
 */
@Module({
  imports: [TypeOrmModule.forFeature([TiendaEntity])],
  controllers: [StoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}
