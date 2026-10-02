import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Auditoria } from '../entities/auditoria.entity';
import { AuditoriaCambio } from '../entities/auditoria-cambio.entity';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'retail_analytics',
    // Este servicio es dueño de estas 2 tablas y no escribe otras
    // (Postgres compartido, tablas por dueño).
    entities: [Auditoria, AuditoriaCambio],
    synchronize: false,
  }),
);
