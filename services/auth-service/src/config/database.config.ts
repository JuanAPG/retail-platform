import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ModuloEntity } from '../entities/modulo.entity';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { RolModuloPermisoEntity } from '../entities/rol-modulo-permiso.entity';
import { RoleEntity } from '../entities/role.entity';
import { UsuarioEntity } from '../entities/usuario.entity';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'retail_analytics',
    // Este servicio es dueño de estas 5 tablas y no escribe otras
    // (Postgres compartido, tablas por dueño).
    entities: [ModuloEntity, ProveedorEntity, RolModuloPermisoEntity, RoleEntity, UsuarioEntity],
    synchronize: false,
  }),
);
