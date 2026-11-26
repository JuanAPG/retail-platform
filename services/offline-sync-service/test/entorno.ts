/**
 * Entorno de la integración, ANTES de importar la app (el cliente de Redis
 * lee el entorno la primera vez que se usa). Base de Mongo propia
 * (`offline_sync_it`), separada de `retaildb`.
 */
const usarDocker = process.env.SYNC_IT_DOCKER !== '0';

process.env.SERVICE_NAME = 'offline-sync-service';
process.env.SERVICE_VERSION = '1.0.0';
process.env.XML_NAMESPACE = 'sync/v1';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';
process.env.MONGO_URL = usarDocker ? 'mongodb://localhost:27118' : process.env.MONGO_URL ?? 'mongodb://localhost:27017';
process.env.MONGO_DB = 'offline_sync_it';
process.env.REDIS_HOST = usarDocker ? 'localhost' : process.env.REDIS_HOST ?? 'localhost';
process.env.REDIS_PORT = usarDocker ? '6418' : process.env.REDIS_PORT ?? '6379';
process.env.BUSINESS_TIMEZONE = 'America/Monterrey';
// La integración general usa el destino simulado (sus ganchos de prueba). La de destinos
// reales (destinos-reales.integracion.spec.ts) cambia a `http` antes de levantar la app.
process.env.SYNC_DESTINO = 'simulado';
