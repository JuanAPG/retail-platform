import { ServiceUnavailableException } from '@nestjs/common';
import { sinMongo } from './corridas-asociacion.repository';

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
