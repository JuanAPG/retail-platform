import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    // Defaults = credenciales simples de infra/docker-compose.yml, para
    // poder correr `npm run start:dev` fuera de Docker contra ese Postgres.
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'retail_user',
    password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
    database: process.env.DB_NAME ?? 'retaildb',
    // Este servicio es dueño de las tablas de corridas, reglas y
    // elasticidades, y no escribe otras (Postgres compartido, tablas por
    // dueño). Se registran con `TypeOrmModule.forFeature` en cada módulo.
    autoLoadEntities: true,
    // db/schema.sql es la fuente de verdad: TypeORM nunca altera el esquema.
    synchronize: false,
  }),
);
