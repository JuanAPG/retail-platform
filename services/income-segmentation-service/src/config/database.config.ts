import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'retail_analytics',
    // Postgres compartido, tablas por dueño: este servicio escribe solo
    // `segmentos_ingreso`, `segmento_versiones` y `zona_clasificaciones`.
    // El esquema lo fija `db/schema.sql`, nunca TypeORM.
    synchronize: false,
  }),
);
