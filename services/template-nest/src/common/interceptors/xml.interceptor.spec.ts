import { normalizarListas, XmlInterceptor } from './xml.interceptor';
import { of, lastValueFrom } from 'rxjs';

function contextoXml() {
  const cabeceras: Record<string, string> = {};
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { accept: 'application/xml' } }),
      getResponse: () => ({ setHeader: (k: string, v: string) => (cabeceras[k] = v) }),
    }),
    cabeceras,
  };
}

describe('XmlInterceptor (listas como <item>)', () => {
  it('paginado: un solo <data> con N <item>', async () => {
    const interceptor = new XmlInterceptor();
    const ctx = contextoXml();
    const salida = await lastValueFrom(
      interceptor.intercept(ctx as never, {
        handle: () => of({ data: [{ id: 1 }, { id: 2 }], total: 2, page: 1, limit: 20 }),
      }),
    );
    const xml = String(salida);
    expect((xml.match(/<data>/g) ?? []).length).toBe(1);
    expect((xml.match(/<item>/g) ?? []).length).toBe(2);
  });

  it('objeto único: sin <item> y sin repetir etiquetas', async () => {
    const interceptor = new XmlInterceptor();
    const ctx = contextoXml();
    const salida = await lastValueFrom(
      interceptor.intercept(ctx as never, { handle: () => of({ id: 1, nombre: 'X' }) }),
    );
    const xml = String(salida);
    expect(xml).not.toContain('<item>');
    expect(xml).toContain('<id>1</id>');
  });

  it('arreglo vacío: <data/> autocerrada', () => {
    expect(normalizarListas({ data: [], total: 0 })).toEqual({ data: { item: [] }, total: 0 });
  });
});
