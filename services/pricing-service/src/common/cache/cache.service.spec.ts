import { getRedis } from '../auth/redis.client';
import { CacheService } from './cache.service';

jest.mock('../auth/redis.client');

type RedisFalso = {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  incr: jest.Mock;
  expire: jest.Mock;
};

function redisFalso(): RedisFalso {
  const redis: RedisFalso = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  };
  (getRedis as jest.Mock).mockReturnValue(redis);
  return redis;
}

describe('CacheService.obtener', () => {
  it('en un MISS carga, guarda como JSON con TTL y devuelve el valor', async () => {
    const redis = redisFalso();
    const cargar = jest.fn().mockResolvedValue({ a: 1 });

    const valor = await new CacheService().obtener('pricing:x', 300, cargar);

    expect(valor).toEqual({ a: 1 });
    expect(cargar).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('pricing:x', '{"a":1}', 'EX', 300);
  });

  it('en un HIT devuelve lo guardado y NO ejecuta la carga', async () => {
    const redis = redisFalso();
    redis.get.mockResolvedValue('{"a":2}');
    const cargar = jest.fn();

    const valor = await new CacheService().obtener('pricing:x', 300, cargar);

    expect(valor).toEqual({ a: 2 });
    expect(cargar).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('un arreglo vacío o un 0 cacheados cuentan como HIT (no se confunden con "no hay nada")', async () => {
    const redis = redisFalso();
    redis.get.mockResolvedValue('[]');
    const cargar = jest.fn();

    expect(await new CacheService().obtener('k', 60, cargar)).toEqual([]);
    expect(cargar).not.toHaveBeenCalled();
  });

  it('si Redis falla al leer, resuelve contra la base y sigue funcionando', async () => {
    const redis = redisFalso();
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const cargar = jest.fn().mockResolvedValue('de la base');

    expect(await new CacheService().obtener('k', 60, cargar)).toBe('de la base');
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it('si Redis falla al guardar, igual devuelve el valor', async () => {
    const redis = redisFalso();
    redis.set.mockRejectedValue(new Error('READONLY'));

    expect(await new CacheService().obtener('k', 60, async () => 42)).toBe(42);
  });

  it('si Redis no responde a tiempo, no deja colgada la consulta', async () => {
    const redis = redisFalso();
    redis.get.mockReturnValue(new Promise(() => undefined)); // nunca responde
    redis.set.mockReturnValue(new Promise(() => undefined));

    const inicio = Date.now();
    const valor = await new CacheService().obtener('k', 60, async () => 'ok');

    expect(valor).toBe('ok');
    expect(Date.now() - inicio).toBeLessThan(1500);
  });

  it('un error de la carga se propaga y NO se guarda nada (no hay caché de errores)', async () => {
    const redis = redisFalso();

    await expect(
      new CacheService().obtener('k', 60, async () => {
        throw new Error('404');
      }),
    ).rejects.toThrow('404');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('un JSON corrupto en Redis se ignora y se vuelve a cargar', async () => {
    const redis = redisFalso();
    redis.get.mockResolvedValue('{no es json');

    expect(await new CacheService().obtener('k', 60, async () => 'limpio')).toBe('limpio');
  });
});

describe('CacheService — versiones y borrado', () => {
  it('version devuelve 0 si no hay llave y el número guardado si la hay', async () => {
    const redis = redisFalso();
    const cache = new CacheService();

    expect(await cache.version('pricing:v:p1')).toBe(0);
    redis.get.mockResolvedValue('7');
    expect(await cache.version('pricing:v:p1')).toBe(7);
  });

  it('version devuelve 0 (sin lanzar) si Redis falla', async () => {
    const redis = redisFalso();
    redis.get.mockRejectedValue(new Error('caído'));

    expect(await new CacheService().version('pricing:v:p1')).toBe(0);
  });

  it('invalidarGrupo sube la versión y le da una vida larga, mayor que cualquier TTL de datos', async () => {
    const redis = redisFalso();

    await new CacheService().invalidarGrupo('pricing:v:p1');

    expect(redis.incr).toHaveBeenCalledWith('pricing:v:p1');
    expect(redis.expire).toHaveBeenCalledWith('pricing:v:p1', 86400);
  });

  it('invalidarGrupo no lanza si Redis falla', async () => {
    const redis = redisFalso();
    redis.incr.mockRejectedValue(new Error('caído'));

    await expect(new CacheService().invalidarGrupo('pricing:v:p1')).resolves.toBeUndefined();
  });

  it('borrar elimina llaves exactas y no hace nada sin llaves', async () => {
    const redis = redisFalso();
    const cache = new CacheService();

    await cache.borrar('catalog:units', 'catalog:categories');
    await cache.borrar();

    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith('catalog:units', 'catalog:categories');
  });
});
