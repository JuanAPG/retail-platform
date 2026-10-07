import { HealthController } from './health.controller';
import * as cliente from '../common/auth/redis.client';

/**
 * El health reporta sus dependencias y SIEMPRE responde (nunca lanza):
 * si se cayera con Postgres abajo, el healthcheck de Docker y quien
 * revisa la demo no podrían distinguir "servicio muerto" de "base caída".
 */
function controlador(postgresOk: boolean, redisOk: boolean) {
  const dataSource = {
    query: jest.fn(async () => {
      if (!postgresOk) throw new Error('connect ECONNREFUSED 172.18.0.2:5432');
      return [{ '?column?': 1 }];
    }),
  };
  jest.spyOn(cliente, 'getRedis').mockReturnValue({
    ping: jest.fn(async () => {
      if (!redisOk) throw new Error('Redis no responde');
      return 'PONG';
    }),
  } as never);
  return new HealthController(dataSource as never);
}

describe('HealthController', () => {
  const original = process.env.SERVICE_NAME;

  beforeEach(() => {
    process.env.SERVICE_NAME = 'core-process-service';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (original === undefined) delete process.env.SERVICE_NAME;
    else process.env.SERVICE_NAME = original;
  });

  it('con todo arriba reporta ok y verifica las dos dependencias', async () => {
    const r = await controlador(true, true).check();
    expect(r).toMatchObject({
      status: 'ok',
      service: 'core-process-service',
      checks: { postgres: 'ok', redis: 'ok' },
    });
    expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('con Postgres caído reporta degraded sin lanzar', async () => {
    const r = await controlador(false, true).check();
    expect(r.status).toBe('degraded');
    expect(r.checks.postgres).toMatch(/ECONNREFUSED/);
    expect(r.checks.redis).toBe('ok');
  });

  it('con Redis caído reporta degraded sin lanzar', async () => {
    const r = await controlador(true, false).check();
    expect(r.status).toBe('degraded');
    expect(r.checks.redis).toMatch(/Redis no responde/);
  });

  it('con las dos caídas sigue respondiendo', async () => {
    await expect(controlador(false, false).check()).resolves.toMatchObject({
      status: 'degraded',
    });
  });
});
