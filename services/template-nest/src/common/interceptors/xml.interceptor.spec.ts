import { Reflector } from '@nestjs/core';
import { normalizar, quiereXml, serializarXml, XmlInterceptor } from './xml.interceptor';
import { XML_ROOT_KEY } from '../decorators/xml-root.decorator';
import { of, lastValueFrom } from 'rxjs';

function contexto(accept: string) {
  const cabeceras: Record<string, string> = {};
  return {
    cabeceras,
    ctx: {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({ headers: { accept } }),
        getResponse: () => ({ setHeader: (k: string, v: string) => (cabeceras[k] = v) }),
      }),
    } as never,
  };
}

/** Reflector que devuelve la metadata de `@XmlRoot` que se le indique. */
function reflectorCon(meta: object | undefined) {
  return {
    getAllAndOverride: jest.fn((clave: string) => (clave === XML_ROOT_KEY ? meta : undefined)),
  } as unknown as Reflector;
}

const NS_ORIGINAL = process.env.XML_NAMESPACE;

/**
 * Sin namespace por defecto en todas las pruebas: el valor real lo inyecta
 * el compose por servicio, y un spec que dependa del entorno falla en un
 * contenedor y pasa en local. El bloque de namespace lo fija a propósito.
 */
beforeEach(() => {
  delete process.env.XML_NAMESPACE;
});

afterAll(() => {
  if (NS_ORIGINAL === undefined) delete process.env.XML_NAMESPACE;
  else process.env.XML_NAMESPACE = NS_ORIGINAL;
});

async function serializar(accept: string, cuerpo: unknown, meta?: object) {
  const interceptor = new XmlInterceptor(reflectorCon(meta));
  const { ctx, cabeceras } = contexto(accept);
  const salida = await lastValueFrom(
    interceptor.intercept(ctx, { handle: () => of(cuerpo) }),
  );
  return { xml: String(salida), salida, cabeceras };
}

describe('XmlInterceptor — raíz y namespace (contrato XSD)', () => {
  it('sin @XmlRoot conserva <response>: no rompe lo que no se declaró', async () => {
    const { xml } = await serializar('application/xml', { id: 1 });
    expect(xml).toContain('<response>');
    expect(xml).not.toContain('xmlns');
  });

  it('con @XmlRoot usa el elemento que declara el XSD', async () => {
    const { xml } = await serializar('application/xml', { id: 'z1' }, { elemento: 'zoneListResponse' });
    expect(xml).toContain('<zoneListResponse>');
    expect(xml).toContain('</zoneListResponse>');
    expect(xml).not.toContain('<response>');
  });

  it('pone el xmlns del servicio en la raíz, que califica a los hijos', async () => {
    process.env.XML_NAMESPACE = 'catalog/v1';
    const { xml } = await serializar(
      'application/xml',
      { data: [{ id: 'z1' }], total: 1 },
      { elemento: 'zoneListResponse' },
    );
    expect(xml).toContain('<zoneListResponse xmlns="catalog/v1">');
    // Los hijos NO llevan prefijo: con elementFormDefault="qualified" el
    // xmlns por defecto de la raíz ya los califica.
    expect(xml).toContain('<total>1</total>');
    expect(xml).not.toContain(':total>');
  });

  it('emite la declaración XML al inicio', async () => {
    const { xml } = await serializar('application/xml', { id: 1 }, { elemento: 'zoneResponse' });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('un escalar con namespace sigue siendo un documento válido', async () => {
    process.env.XML_NAMESPACE = 'decision/v1';
    const { xml } = await serializar('application/xml', 128.4, { elemento: 'indiceAccesibilidad' });
    expect(xml).toContain('<indiceAccesibilidad xmlns="decision/v1">128.4</indiceAccesibilidad>');
  });
});

describe('XmlInterceptor — fechas y nulos', () => {
  it('un Date se emite como ISO, no como elemento vacío', async () => {
    const { xml } = await serializar('application/xml', {
      id: 'abc',
      createdAt: new Date('2026-09-02T10:15:00.000Z'),
    });
    expect(xml).toContain('<createdAt>2026-09-02T10:15:00.000Z</createdAt>');
    expect(xml).not.toContain('<createdAt></createdAt>');
  });

  it('los nulos se OMITEN: un elemento vacío no es un xs:decimal válido', () => {
    expect(normalizar({ a: null, b: undefined, c: 1 })).toEqual({ c: 1 });
  });

  it('un nulo anidado o dentro de una lista también se omite', () => {
    expect(normalizar({ data: [{ lift: null, support: 0.5 }], meta: { r: null } })).toEqual({
      data: { item: [{ support: 0.5 }] },
      meta: {},
    });
  });

  it('siemprePresentes emite el elemento vacío (uniones *OrEmpty)', async () => {
    // `algorithms-core` declara `lift` y `transactionCount` OBLIGATORIOS con
    // tipo `decimalOrEmpty`/`integerOrEmpty`: omitirlos daría
    // "Missing child element", así que ahí el nulo va como elemento vacío.
    const { xml } = await serializar(
      'application/xml',
      { rule: 'A->B', lift: null, transactionCount: null, support: 0.5 },
      { elemento: 'aprioriRunResponse', siemprePresentes: ['lift', 'transactionCount'] },
    );
    expect(xml).toMatch(/<lift><\/lift>|<lift\/>/);
    expect(xml).toMatch(/<transactionCount><\/transactionCount>|<transactionCount\/>/);
    expect(xml).toContain('<support>0.5</support>');
  });

  it('siemprePresentes aplica a cualquier profundidad', () => {
    expect(
      normalizar({ data: [{ lift: null, otro: null }] }, new Set(['lift'])),
    ).toEqual({ data: { item: [{ lift: '' }] } });
  });

  it('un 0 y un false NO se omiten (no son nulos)', () => {
    expect(normalizar({ a: 0, b: false, c: '' })).toEqual({ a: 0, b: false, c: '' });
  });
});

describe('XmlInterceptor — listas', () => {
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
    expect(normalizar({ data: [], total: 0 })).toEqual({ data: { item: [] }, total: 0 });
  });
});

describe('XmlInterceptor — negociación de Accept', () => {
  it('application/xml, text/xml y *+xml dan XML con Content-Type', async () => {
    for (const accept of ['application/xml', 'text/xml', 'application/soap+xml']) {
      const { xml, cabeceras } = await serializar(accept, { id: 1 });
      expect(xml.startsWith('<?xml')).toBe(true);
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

describe('serializarXml (compartida con el filtro de errores)', () => {
  it('acepta raíz y namespace explícitos', () => {
    const xml = serializarXml(
      { statusCode: 404, code: 'NOT_FOUND' },
      { raiz: 'error', namespace: 'pricing/v1' },
    );
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<error xmlns="pricing/v1">');
    expect(xml).toContain('<code>NOT_FOUND</code>');
  });

  it('sin Reflector el interceptor sigue funcionando con la raíz default', async () => {
    const interceptor = new XmlInterceptor();
    const { ctx } = contexto('application/xml');
    const salida = await lastValueFrom(
      interceptor.intercept(ctx, { handle: () => of({ id: 1 }) }),
    );
    expect(String(salida)).toContain('<response>');
  });
});
