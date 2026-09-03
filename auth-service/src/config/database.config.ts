import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { RoleEntity } from '../entities/role.entity';
import { UsuarioEntity } from '../entities/usuario.entity';
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
    entities: [RoleEntity, UsuarioEntity, ProveedorEntity],
    // El schema ya fue creado con schema.sql (DDL versionado en el repo).
    // NUNCA se activa synchronize aquí: TypeORM solo lee/escribe filas,
    // jamás debe intentar recrear o alterar la estructura de las tablas.
    synchronize: false,
    logging: process.env.NODE_ENV === 'development',
  }),
);
