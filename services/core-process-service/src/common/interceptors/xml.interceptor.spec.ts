import { normalizarListas, quiereXml, serializarXml, XmlInterceptor } from './xml.interceptor';
import { of, lastValueFrom } from 'rxjs';

function contexto(accept: string) {
  const cabeceras: Record<string, string> = {};
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { accept } }),
      getResponse: () => ({ setHeader: (k: string, v: string) => (cabeceras[k] = v) }),
    }),
    cabeceras,
  };
}

async function serializar(accept: string, cuerpo: unknown) {
  const interceptor = new XmlInterceptor();
  const ctx = contexto(accept);
  const salida = await lastValueFrom(
    interceptor.intercept(ctx as never, { handle: () => of(cuerpo) }),
  );
  return { xml: String(salida), salida, cabeceras: ctx.cabeceras };
}

describe('XmlInterceptor (listas como <item>)', () => {
  it('paginado: un solo <data> con N <item>', async () => {
    const { xml } = await serializar('application/xml', {
      data: [{ id: 1 }, { id: 2 }],
      total: 2,
      page: 1,
      limit: 20,
    });
    expect((xml.match(/<data>/g) ?? []).length).toBe(1);
    expect((xml.match(/<item>/g) ?? []).length).toBe(2);
  });

  it('objeto único: sin <item> y sin repetir etiquetas', async () => {
    const { xml } = await serializar('application/xml', { id: 1, nombre: 'X' });
    expect(xml).not.toContain('<item>');
    expect(xml).toContain('<id>1</id>');
  });

  it('arreglo vacío: <data/> autocerrada', () => {
    expect(normalizarListas({ data: [], total: 0 })).toEqual({ data: { item: [] }, total: 0 });
  });
});

describe('XmlInterceptor (fechas)', () => {
  // Un Date es `typeof 'object'` y recorrerlo da []: sin tratarlo aparte,
  // la etiqueta se cerraba vacía y la fecha se perdía.
  it('un Date se emite como ISO, no como elemento vacío', async () => {
    const { xml } = await serializar('application/xml', {
      id: 'abc',
      fecha: new Date('2026-09-02T10:15:00.000Z'),
    });
    expect(xml).toContain('<fecha>2026-09-02T10:15:00.000Z</fecha>');
    expect(xml).not.toContain('<fecha></fecha>');
    expect(xml).not.toContain('<fecha/>');
  });

  it('fechas anidadas y dentro de listas también se emiten', async () => {
    const { xml } = await serializar('application/xml', {
      data: [{ date: new Date('2026-08-02T16:15:00.000Z') }],
      meta: { builtAt: new Date('2026-08-03T00:00:00.000Z') },
    });
    expect(xml).toContain('<date>2026-08-02T16:15:00.000Z</date>');
    expect(xml).toContain('<builtAt>2026-08-03T00:00:00.000Z</builtAt>');
  });

  it('undefined no desaparece de la salida', () => {
    expect(normalizarListas({ a: undefined, b: 1 })).toEqual({ a: null, b: 1 });
  });
});

describe('XmlInterceptor (negociación de Accept)', () => {
  it('application/xml y text/xml dan XML con prólogo y Content-Type', async () => {
    for (const accept of ['application/xml', 'text/xml', 'application/soap+xml']) {
      const { xml, cabeceras } = await serializar(accept, { id: 1 });
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(cabeceras['Content-Type']).toBe('application/xml; charset=utf-8');
    }
  });

  it('JSON, */* y sin header pasan la respuesta sin tocarla', async () => {
    for (const accept of ['application/json', '*/*', '']) {
      const { salida } = await serializar(accept, { id: 1 });
      expect(salida).toEqual({ id: 1 });
    }
  });

  it('respeta los q-values: si el cliente prefiere JSON, responde JSON', () => {
    expect(quiereXml('text/html, application/xml;q=0.1, application/json;q=0.9')).toBe(false);
    expect(quiereXml('application/json;q=0.2, application/xml;q=0.8')).toBe(true);
    expect(quiereXml('application/xml;q=0')).toBe(false);
  });
});

describe('serializarXml (compartido con el filtro de errores)', () => {
  it('envuelve en <response> con prólogo', () => {
    const xml = serializarXml({ statusCode: 404, code: 'NOT_FOUND' });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<response>');
    expect(xml).toContain('<code>NOT_FOUND</code>');
  });
});
