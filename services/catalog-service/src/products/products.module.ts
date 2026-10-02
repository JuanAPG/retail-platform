import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionGuard } from '../common/auth/session.guard';
import { CacheService } from '../common/cache/cache.service';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { ProductoRevisionEntity } from '../entities/producto-revision.entity';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { UnidadMedidaEntity } from '../entities/unidad-medida.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * M04 — Productos y presentaciones. Las **presentaciones** son una tabla
 * relacionada (RF-35): precios, inventario y líneas de venta apuntan a la
 * presentación, no al producto. `ProveedorEntity` es de auth-service: aquí
 * solo se lee.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProveedorEntity,
      CategoriaProductoEntity,
      ProductoEntity,
      ProductoPresentacionEntity,
      ProductoRevisionEntity,
      UnidadMedidaEntity,
    ]),
    JwtModule.register({}),
  ],
  controllers: [ProductsController],
  providers: [ProductsService, SessionGuard, CacheService],
  exports: [ProductsService],
})
export class ProductsModule {}
