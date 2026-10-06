import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Basket } from '../entities/basket.entity';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { CodigoPostalEntity } from '../entities/codigo-postal.entity';
import { DireccionEntity } from '../entities/direccion.entity';
import { Importacion } from '../entities/importacion.entity';
import { ImportacionError } from '../entities/importacion-error.entity';
import { ImportacionFila } from '../entities/importacion-fila.entity';
import { MunicipioEntity } from '../entities/municipio.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { RoleEntity } from '../entities/role.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionDetail } from '../entities/transaction-detail.entity';
import { UnidadMedidaEntity } from '../entities/unidad-medida.entity';
import { UsuarioEntity } from '../entities/usuario.entity';
import { ZonaEntity } from '../entities/zona.entity';
import { ProveedorEntity } from '../entities/proveedor.entity';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'retail_analytics',
    // M06+M07 escriben transacciones, detalle, importaciones y canastas;
    // M09 solo lee. `UsuarioEntity`/`RoleEntity` solo resuelven la relación
    // de importaciones (lectura); este servicio no gestiona usuarios.
    entities: [
      Basket,
      CategoriaProductoEntity,
      CodigoPostalEntity,
      DireccionEntity,
      Importacion,
      ImportacionError,
      ImportacionFila,
      MunicipioEntity,
      ProductoEntity,
      ProductoPresentacionEntity,
      RoleEntity,
      TiendaEntity,
      Transaction,
      TransactionDetail,
      UnidadMedidaEntity,
      UsuarioEntity,
      ZonaEntity,
      ProveedorEntity,
    ],
    synchronize: false,
  }),
);
