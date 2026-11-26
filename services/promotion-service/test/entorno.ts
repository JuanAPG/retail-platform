/**
 * Entorno de la integración ANTES de importar la app (el cliente de Redis y
 * TypeORM leen el entorno al crearse). Apunta al stack LOCAL de
 * infra/docker-compose.yml: Postgres, Redis, auth, catalog, pricing, audit y
 * notifications en sus puertos publicados.
 */
process.env.SERVICE_NAME = 'promotion-service';
process.env.SERVICE_VERSION = '1.0.0';
process.env.XML_NAMESPACE = 'promotion/v1';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';
process.env.REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT ?? '6379';
process.env.DB_HOST = process.env.DB_HOST ?? 'localhost';
process.env.DB_PORT = process.env.DB_PORT ?? '5432';
process.env.DB_USER = process.env.DB_USER ?? 'retail_user';
process.env.DB_PASSWORD = process.env.DB_PASSWORD ?? 'retail_pass_2026';
process.env.DB_NAME = process.env.DB_NAME ?? 'retaildb';
process.env.BUSINESS_TIMEZONE = 'America/Monterrey';
process.env.CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL ?? 'http://localhost:3102';
process.env.PRICING_SERVICE_URL = process.env.PRICING_SERVICE_URL ?? 'http://localhost:3103';
process.env.AUDIT_SERVICE_URL = process.env.AUDIT_SERVICE_URL ?? 'http://localhost:3110';
process.env.NOTIFICATIONS_SERVICE_URL = process.env.NOTIFICATIONS_SERVICE_URL ?? 'http://localhost:3109';
