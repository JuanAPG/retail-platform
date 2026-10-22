import { armarSalud, NO_CONFIGURADO, sinConfigurar, verificarMongo, verificarPostgres } from './checks';

describe('health con dependencias (T-02)', () => {
  it('todo ok → status ok, con latencia por check y duración total', async () => {
    const salud = await armarSalud({ postgres: async () => 'ok', redis: async () => 'ok' });

    expect(salud).toMatchObject({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
    expect(Object.keys(salud.latencyMs)).toEqual(['postgres', 'redis']);
    expect(salud.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(salud.timestamp))).toBe(false);
  });

  it('"no configurado" no degrada; un "error" sí', async () => {
    expect((await armarSalud({ mongodb: sinConfigurar, redis: async () => 'ok' })).status).toBe('ok');
    expect((await armarSalud({ mongodb: async () => 'error: caído', redis: async () => 'ok' })).status).toBe('degraded');
  });

  it('un check que lanza no tumba el health: sale como error con su motivo', async () => {
    const salud = await armarSalud({
      redis: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    expect(salud).toMatchObject({ status: 'degraded', checks: { redis: 'error: ECONNREFUSED' } });
  });

  it('un check que no responde se corta a los 2 s y cuenta como error', async () => {
    jest.useFakeTimers();
    try {
      const pendiente = armarSalud({ postgres: () => new Promise<string>(() => undefined) });
      await jest.advanceTimersByTimeAsync(2000);

      expect((await pendiente).checks.postgres).toBe('error: no respondió en 2000 ms');
    } finally {
      jest.useRealTimers();
    }
  });

  it('los checks corren en paralelo, no uno tras otro', async () => {
    const tarda = () => new Promise<string>((r) => setTimeout(() => r('ok'), 100));
    const inicio = Date.now();

    await armarSalud({ a: tarda, b: tarda, c: tarda });

    expect(Date.now() - inicio).toBeLessThan(250);
  });

  it('verificarPostgres hace SELECT 1 y reporta el motivo si falla', async () => {
    const query = jest.fn(async () => [{ '?column?': 1 }]);
    expect(await verificarPostgres({ query })).toBe('ok');
    expect(query).toHaveBeenCalledWith('SELECT 1');

    expect(await verificarPostgres({ query: async () => Promise.reject(new Error('password authentication failed')) })).toBe(
      'error: password authentication failed',
    );
  });

  it('verificarMongo exige conexión abierta y un ping que responda', async () => {
    const db = { admin: () => ({ ping: async () => ({ ok: 1 }) }) };
    expect(await verificarMongo({ readyState: 1, db })).toBe('ok');
    expect(await verificarMongo({ readyState: 0, db })).toBe('error: sin conexión a MongoDB');
    expect(await verificarMongo({ readyState: 1, db: { admin: () => ({ ping: () => Promise.reject(new Error('not primary')) }) } })).toBe(
      'error: not primary',
    );
  });

  it('sinConfigurar devuelve la marca acordada', async () => {
    expect(await sinConfigurar()).toBe(NO_CONFIGURADO);
  });
});
