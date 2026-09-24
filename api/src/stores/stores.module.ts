import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TiendaEntity } from '../entities/tienda.entity';
import { DireccionEntity } from '../entities/direccion.entity';
import { CodigoPostalEntity } from '../entities/codigo-postal.entity';
import { ZonaEntity } from '../entities/zona.entity';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

/**
 * M02 — Tiendas. Responsable: Pamela Rodríguez.
 * Rama: `feature/m02-tiendas`
 *
 * CRUD completo (RF-05, RF-06). Necesita DireccionEntity y
 * CodigoPostalEntity porque una tienda se crea junto con su domicilio,
 * y ZonaEntity para validar que la zona indicada exista antes de
 * asociarla.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TiendaEntity, DireccionEntity, CodigoPostalEntity, ZonaEntity]),
  ],
  controllers: [StoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}
