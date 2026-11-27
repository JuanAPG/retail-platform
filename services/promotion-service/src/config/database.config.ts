import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'retail_user',
    password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
    database: process.env.DB_NAME ?? 'retaildb',
    // Postgres compartido, tablas por dueño: este servicio escribe SOLO
    // `promociones` y `promocion_eventos` (contrato §13). El esquema lo fija
    // `db/schema.sql` (y db/migraciones/sprint4_promotion.sql), nunca TypeORM.
    synchronize: false,
    // Si Postgres deja de responder, la consulta falla en vez de quedarse
    // colgada y la operación responde 503 (D-25).
    extra: { connectionTimeoutMillis: 3000, query_timeout: 10000 },
  }),
);
