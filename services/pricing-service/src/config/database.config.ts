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
    // Este servicio es dueño de `precios` y no escribe otras tablas
    // (Postgres compartido, tablas por dueño). Presentaciones, tiendas y
    // zonas son de catalog-service: aquí solo se leen por SQL. Las entidades
    // se registran con `TypeOrmModule.forFeature` en cada módulo.
    autoLoadEntities: true,
    synchronize: false,
  }),
);
