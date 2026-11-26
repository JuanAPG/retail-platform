import { asegurarMongo } from './asegurar-mongo';

function conexion(readyState: number, openUri: () => Promise<unknown>) {
  const c = { readyState, openUri: jest.fn(openUri), asPromise: jest.fn(async () => undefined) };
  return c;
}

describe('asegurarMongo (D-25: Mongo caído no tumba el servicio)', () => {
  it('conectado: true sin intentar nada', async () => {
    const c = conexion(1, async () => undefined);
    expect(await asegurarMongo(c as never)).toBe(true);
    expect(c.openUri).not.toHaveBeenCalled();
  });

  it('desconectado: reabre la conexión y, si Mongo volvió, true', async () => {
    const c = conexion(0, async () => {
      c.readyState = 1;
    });
    expect(await asegurarMongo(c as never)).toBe(true);
    expect(c.openUri).toHaveBeenCalledTimes(1);
  });

  it('Mongo sigue caído (rechazo o fallo síncrono): false, nunca lanza', async () => {
    expect(await asegurarMongo(conexion(0, async () => Promise.reject(new Error('ECONNREFUSED'))) as never)).toBe(false);
    const sincrono = { readyState: 0, openUri: () => { throw new Error('boom'); } };
    expect(await asegurarMongo(sincrono as never)).toBe(false);
  });

  it('peticiones simultáneas comparten un solo intento', async () => {
    let soltar!: () => void;
    const c = conexion(0, () => new Promise<void>((ok) => { soltar = () => { c.readyState = 1; ok(); }; }));
    const a = asegurarMongo(c as never);
    const b = asegurarMongo(c as never);
    await Promise.resolve();
    await Promise.resolve();
    soltar();
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(c.openUri).toHaveBeenCalledTimes(1);
  });
});
