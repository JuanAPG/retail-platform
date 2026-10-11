import type Redis from 'ioredis';
import { createServer, Server, Socket } from 'net';

/**
 * Redis "colgado": TCP vivo, sin respuesta. Es lo que deja un
 * `docker pause redis`, un contenedor saturado o la red a medias — y es
 * el caso que importa, porque el `SessionGuard` solo puede contestar 503
 * si el comando a Redis RECHAZA. Sin `commandTimeout`, `exists()` no
 * rechaza nunca y la petición se queda colgada para siempre (reproducido
 * en documents-service, QA-DOC54-01).
 *
 * El servidor de la prueba acepta la conexión y no contesta nada.
 */
describe('cliente Redis con Redis colgado (TCP vivo, sin respuesta)', () => {
  let servidor: Server;
  let puerto: number;
  const conexiones: Socket[] = [];
  const ENV = { ...process.env };
  let cliente: Redis | null = null;

  beforeAll(async () => {
    servidor = createServer((socket) => {
      // Acepta y calla: nunca responde al PING ni al EXISTS. Se guarda
      // para poder cerrarla al final (si no, `close()` nunca termina).
      conexiones.push(socket);
    });
    await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
    puerto = (servidor.address() as { port: number }).port;
  });

  afterAll(async () => {
    for (const socket of conexiones) socket.destroy();
    await new Promise<void>((cerrado) => servidor.close(() => cerrado()));
    process.env = ENV;
  });

  afterEach(() => {
    // Sin esto el cliente sigue reintentando la conexión y jest no termina
    // (`false`: no vuelvas a conectar al desconectar).
    cliente?.disconnect(false);
    cliente?.removeAllListeners();
    cliente = null;
  });

  beforeEach(() => {
    jest.resetModules();
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(puerto);
    process.env.REDIS_COMMAND_TIMEOUT = '300';
  });

  it('un comando rechaza en el tope en vez de quedarse colgado', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getRedis } = require('./redis.client') as typeof import('./redis.client');
    cliente = getRedis();
    const empezo = Date.now();
    await expect(cliente.exists('session:cualquiera')).rejects.toThrow(/timed out/i);
    expect(Date.now() - empezo).toBeLessThan(3000);
  }, 10000);

  it('el tope es configurable con REDIS_COMMAND_TIMEOUT', () => {
    process.env.REDIS_COMMAND_TIMEOUT = '1234';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getRedis } = require('./redis.client') as typeof import('./redis.client');
    cliente = getRedis();
    expect(cliente.options.commandTimeout).toBe(1234);
  });

  it('un solo cliente por proceso (singleton del módulo)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getRedis } = require('./redis.client') as typeof import('./redis.client');
    cliente = getRedis();
    expect(getRedis()).toBe(cliente);
  });
});
