import Redis from 'ioredis';

/**
 * Cliente Redis compartido del servicio — NO CAMBIAR su forma de uso.
 * Un solo cliente por proceso (singleton en este módulo).
 * Usos fijados (Sprint 2+3): `session:{userId}` (sesión activa con
 * expiración), `revoked:{jti}` (tokens invalidados, con TTL) y
 * `catalog:*` (caché de catálogos). Sin auth en local a propósito.
 */
let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }
  return client;
}
