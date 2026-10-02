import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionGuard } from '../common/auth/session.guard';
import { CodigoPostalEntity } from '../entities/codigo-postal.entity';
import { DireccionEntity } from '../entities/direccion.entity';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { ZonaEntity } from '../entities/zona.entity';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

/**
 * M02 — Tiendas (RF-05, RF-06). Una tienda se crea junto con su domicilio
 * (DireccionEntity); ZonaEntity y CodigoPostalEntity validan que la zona y
 * el CP existan. ProveedorEntity es de auth-service: aquí solo se lee.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TiendaEntity,
      DireccionEntity,
      CodigoPostalEntity,
      ZonaEntity,
      ProveedorEntity,
    ]),
    JwtModule.register({}),
  ],
  controllers: [StoresController],
  providers: [StoresService, SessionGuard],
  exports: [StoresService],
})
export class StoresModule {}
