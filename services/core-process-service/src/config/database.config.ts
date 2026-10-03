import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Basket } from '../entities/basket.entity';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { CodigoPostalEntity } from '../entities/codigo-postal.entity';
import { DireccionEntity } from '../entities/direccion.entity';
import { MunicipioEntity } from '../entities/municipio.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionDetail } from '../entities/transaction-detail.entity';
import { UnidadMedidaEntity } from '../entities/unidad-medida.entity';
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
    // M09 solo LEE estas tablas para agregar (Postgres compartido,
    // tablas por dueño; la escritura de transacciones/canastas vive aquí
    // mismo en el servicio, las analíticas no escriben nada).
    entities: [
      Basket,
      CategoriaProductoEntity,
      CodigoPostalEntity,
      DireccionEntity,
      MunicipioEntity,
      ProductoEntity,
      ProductoPresentacionEntity,
      TiendaEntity,
      Transaction,
      TransactionDetail,
      UnidadMedidaEntity,
      ZonaEntity,
      ProveedorEntity,
    ],
    synchronize: false,
  }),
);
