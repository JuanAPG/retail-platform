import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { ProductoRevisionEntity } from '../entities/producto-revision.entity';
import { UnidadMedidaEntity } from '../entities/unidad-medida.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * M04 — Productos y presentaciones. Responsable: Pamela Rodríguez.
 * Rama: `feature/m04-productos`
 *
 * Ya implementado: catálogo, y el flujo de alta propuesta por Proveedor
 * y resuelta por Gerente de categoría (RF-12).
 *
 * Las **presentaciones** ya existen como tabla relacionada (RF-35):
 * `producto_presentaciones`. Precios, inventario y líneas de venta
 * apuntan a la presentación, no al producto.
 *
 * Pendiente: CRUD de presentaciones e imágenes desde el portal.
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
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
