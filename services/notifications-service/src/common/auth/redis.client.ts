import Redis from 'ioredis';

/**
 * Cliente Redis compartido del servicio — NO CAMBIAR su forma de uso.
 * Un solo cliente por proceso (singleton en este módulo).
 * Usos fijados (Sprint 2+3): `session:{userId}` (sesión activa con
 * expiración), `revoked:{jti}` (tokens invalidados, con TTL) y
 * `catalog:*` (caché de catálogos). Sin auth en local a propósito.
 *
 * `commandTimeout` NO es un ajuste fino, es lo que hace que el
 * fail-closed del `SessionGuard` funcione: con Redis detenido pero con el
 * TCP vivo (`docker pause`, un contenedor saturado, la red a medias),
 * `exists()` no rechaza nunca, el `try/catch` del guard nunca se dispara
 * y la petición se queda colgada para siempre en vez de responder 503.
 * Mejor un 503 en dos segundos que una petición que nadie contesta.
 */
const TIMEOUT_MS = parseInt(process.env.REDIS_COMMAND_TIMEOUT ?? '2000', 10);

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      // Tope por comando: si Redis acepta la conexión pero no responde,
      // el comando rechaza y el guard puede contestar 503.
      commandTimeout: TIMEOUT_MS,
      // Tope para el saludo inicial, por el mismo motivo.
      connectTimeout: TIMEOUT_MS,
    });
  }
  return client;
}
