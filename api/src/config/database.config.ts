import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { RoleEntity } from '../entities/role.entity';
import { UsuarioEntity } from '../entities/usuario.entity';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { MunicipioEntity } from '../entities/municipio.entity';
import { ZonaEntity } from '../entities/zona.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { CodigoPostalEntity } from '../entities/codigo-postal.entity';
import { DireccionEntity } from '../entities/direccion.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { ProductoRevisionEntity } from '../entities/producto-revision.entity';
import { UnidadMedidaEntity } from '../entities/unidad-medida.entity';
import { IncomeSegment } from '../entities/income-segment.entity';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'retail_analytics',
    // Toda entidad alcanzable por una relación tiene que estar aquí: si
    // falta, TypeORM revienta al resolver el metadata de quien la
    // referencia (TiendaEntity -> DireccionEntity -> CodigoPostalEntity).
    entities: [
      RoleEntity,
      UsuarioEntity,
      ProveedorEntity,
      MunicipioEntity,
      CodigoPostalEntity,
      DireccionEntity,
      ZonaEntity,
      TiendaEntity,
      CategoriaProductoEntity,
      UnidadMedidaEntity,
      ProductoEntity,
      ProductoPresentacionEntity,
      ProductoRevisionEntity,
      IncomeSegment,
    ],
    // El schema ya fue creado con schema.sql (DDL versionado en el repo).
    // NUNCA se activa synchronize aquí: TypeORM solo lee/escribe filas,
    // jamás debe intentar recrear o alterar la estructura de las tablas.
    synchronize: false,
    logging: process.env.NODE_ENV === 'development',
  }),
);
