import { MongoNetworkError, MongoNetworkTimeoutError, MongoServerError, MongoServerSelectionError } from 'mongodb';
import { esCaida } from './mongo.repositorio';

/**
 * Regresión: con Mongo en pausa el driver lanzó `PoolClearedOnNetworkError`
 * (hereda de MongoNetworkError, pero su nombre no empieza con "Mongo") y el
 * servicio respondía 500 en vez de 503 (D-25). Lo encontró la integración.
 */
describe('esCaida (Mongo no responde → 503)', () => {
  class PoolClearedOnNetworkError extends MongoNetworkError {
    override get name() {
      return 'PoolClearedOnNetworkError';
    }
  }

  it.each([
    ['PoolClearedOnNetworkError', new PoolClearedOnNetworkError('interrupted due to server monitor timeout')],
    ['MongoNetworkTimeoutError', new MongoNetworkTimeoutError('connection timed out')],
    ['MongoServerSelectionError', new MongoServerSelectionError('timed out', { error: undefined, servers: new Map() } as never)],
  ])('%s cuenta como caída', (_n, error) => {
    expect(esCaida(error)).toBe(true);
  });

  it('un error del servidor (p. ej. llave duplicada) o un bug NO es caída', () => {
    expect(esCaida(new MongoServerError({ message: 'E11000 duplicate key', code: 11000 }))).toBe(false);
    expect(esCaida(new TypeError('x is undefined'))).toBe(false);
  });
});
