import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsuarioEntity } from '../entities/usuario.entity';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { MunicipioEntity } from '../entities/municipio.entity';
import { ZonaEntity } from '../entities/zona.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { CatalogoController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UsuarioEntity,
      ProveedorEntity,
      MunicipioEntity,
      ZonaEntity,
      TiendaEntity,
      CategoriaProductoEntity,
      ProductoEntity,
    ]),
  ],
  controllers: [CatalogoController],
  providers: [CatalogoService],
})
export class CatalogoModule {}
