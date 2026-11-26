import { ServiceUnavailableException } from '@nestjs/common';
import { CorridasAsociacion, sinMongo } from './corridas-asociacion.repository';

/** Error con el `name` que le pone el driver de Mongo o Mongoose. */
function errorDe(name: string): Error {
  const error = new Error('detalle del driver');
  error.name = name;
  return error;
}

describe('sinMongo (D-25)', () => {
  it.each(['MongoNetworkError', 'MongoServerSelectionError', 'MongoServerError', 'MongooseServerSelectionError'])(
    '%s → 503, nunca 500',
    async (name) => {
      await expect(sinMongo(() => Promise.reject(errorDe(name)))).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );

  it.each(['ValidationError', 'CastError', 'TypeError'])('%s no es de disponibilidad: pasa tal cual', async (name) => {
    const error = errorDe(name);

    await expect(sinMongo(() => Promise.reject(error))).rejects.toBe(error);
  });

  it('sin error devuelve el resultado', async () => {
    expect(await sinMongo(async () => 42)).toBe(42);
  });
});

describe('CorridasAsociacion con Mongo caído al arrancar (D-25, lazyConnection)', () => {
  /** Conexión falsa: `readyState` 0 hasta que `openUri` la "abre" (si Mongo ya volvió). */
  function repositorio(mongoArriba: () => boolean) {
    const conexion = {
      readyState: 0,
      openUri: jest.fn(async () => {
        if (!mongoArriba()) throw new Error('ECONNREFUSED');
        conexion.readyState = 1;
      }),
      asPromise: jest.fn(async () => undefined),
    };
    const consulta = { sort: () => consulta, skip: () => consulta, limit: () => consulta, lean: async () => [] };
    const modelo = {
      create: jest.fn(async (c: object) => ({ toObject: () => c })),
      find: jest.fn(() => consulta),
      countDocuments: jest.fn(async () => 0),
      findOne: jest.fn(() => ({ lean: () => ({ exec: async () => null }) })),
    };
    return { repo: new CorridasAsociacion(modelo as never, conexion as never), conexion, modelo };
  }

  it('sin Mongo: guardar, historial y porId responden 503 sin tocar el modelo', async () => {
    const { repo, modelo } = repositorio(() => false);
    await expect(repo.exigirMongo()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(repo.guardar({} as never)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(repo.historial().getManyAndCount()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(repo.porId('x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(modelo.create).not.toHaveBeenCalled();
    expect(modelo.find).not.toHaveBeenCalled();
  });

  it('cuando Mongo vuelve, la siguiente operación reconecta sola, sin reiniciar el servicio', async () => {
    let arriba = false;
    const { repo, conexion, modelo } = repositorio(() => arriba);
    await expect(repo.exigirMongo()).rejects.toBeInstanceOf(ServiceUnavailableException);

    arriba = true;
    await expect(repo.historial().getManyAndCount()).resolves.toEqual([[], 0]);
    expect(conexion.readyState).toBe(1);
    expect(modelo.find).toHaveBeenCalled();
  });
});
