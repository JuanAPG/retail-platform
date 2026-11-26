import {
  CABECERA_CORRELACION,
  conCorrelacion,
  conIdDeCorrelacion,
  correlacionActual,
  idDeCorrelacion,
  middlewareCorrelacion,
} from './correlacion';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('id de correlación (T-02)', () => {
  it('respeta el id que llega si es válido', () => {
    expect(idDeCorrelacion('movil-7f3a:01')).toBe('movil-7f3a:01');
  });

  it.each([
    ['sin cabecera', undefined],
    ['vacío', ''],
    ['con salto de línea (inyección en logs)', 'abc\ninyectado'],
    ['de más de 100 caracteres', 'x'.repeat(101)],
  ])('genera uno nuevo si llega %s', (_caso, entrante) => {
    expect(idDeCorrelacion(entrante)).toMatch(UUID);
  });

  it('con la cabecera repetida toma la primera', () => {
    expect(idDeCorrelacion(['uno', 'dos'])).toBe('uno');
  });

  it('el middleware deja el id en la petición, en la respuesta y en el contexto de lo que sigue', async () => {
    const req = { headers: { [CABECERA_CORRELACION]: 'op-123' } as Record<string, string | undefined> };
    const res = { setHeader: jest.fn() };
    let visto: string | undefined;

    middlewareCorrelacion(req, res, () => {
      // Lo que corre después (guards, handler, llamadas async) ve el mismo id.
      void Promise.resolve().then(() => {
        visto = correlacionActual();
      });
    });
    await new Promise((r) => setImmediate(r));

    expect(req.headers[CABECERA_CORRELACION]).toBe('op-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-Id', 'op-123');
    expect(visto).toBe('op-123');
  });

  it('conCorrelacion agrega la cabecera solo dentro de una operación', () => {
    expect(conCorrelacion({ Accept: 'application/json' })).toEqual({ Accept: 'application/json' });
    conIdDeCorrelacion('op-9', () => {
      expect(conCorrelacion({ Accept: 'application/json' })).toEqual({ Accept: 'application/json', [CABECERA_CORRELACION]: 'op-9' });
    });
  });

  it('dos operaciones en paralelo no se mezclan', async () => {
    const leer = (id: string) =>
      conIdDeCorrelacion(id, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return correlacionActual();
      });

    expect(await Promise.all([leer('a'), leer('b')])).toEqual(['a', 'b']);
  });
});
