import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { CuerpoXmlInterceptor, cuerpoXmlADto, tipoDeContenido } from './cuerpo-xml';

const PRECIO = { raiz: 'simulacionPrecioRequest', numeros: ['newPrice'] };
const PRESENTACION = { raiz: 'simulacionPresentacionRequest', listas: ['presentationIds'] };

function precio(contenido: string, apertura = '<simulacionPrecioRequest xmlns="decision/v1">', cierre = '</simulacionPrecioRequest>') {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${apertura}${contenido}${cierre}`;
}

/** Mensaje del 400 que lanza la conversión (o `null` si no lanza). */
function motivo(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).message;
  }
}

describe('cuerpoXmlADto', () => {
  it('convierte el XML al mismo objeto que el JSON (newPrice como número)', () => {
    const xml = precio('<presentationId>p</presentationId><zoneId>z</zoneId><newPrice>25.50</newPrice>');
    expect(cuerpoXmlADto(xml, PRECIO)).toEqual({ presentationId: 'p', zoneId: 'z', newPrice: 25.5 });
  });

  it('un número que no es xs:decimal se deja como texto para que el DTO lo rechace', () => {
    for (const valor of ['abc', '1e3', '', '25,5']) {
      const xml = precio(`<newPrice>${valor}</newPrice>`);
      expect(cuerpoXmlADto(xml, PRECIO).newPrice).toBe(valor);
    }
  });

  it('acepta la raíz con prefijo si el prefijo apunta al namespace del contrato', () => {
    const xml = precio('<d:newPrice>3</d:newPrice>', '<d:simulacionPrecioRequest xmlns:d="decision/v1">', '</d:simulacionPrecioRequest>');
    expect(cuerpoXmlADto(xml, PRECIO)).toEqual({ newPrice: 3 });
  });

  it("acepta comillas simples y comentarios antes de la raíz", () => {
    const xml = `<!-- comentario --><simulacionPrecioRequest xmlns='decision/v1'><newPrice>1</newPrice></simulacionPrecioRequest>`;
    expect(cuerpoXmlADto(xml, PRECIO)).toEqual({ newPrice: 1 });
  });

  it('ListaTexto: varios <item>, uno solo o la lista vacía pasan a arreglo', () => {
    const lista = (items: string) =>
      `<simulacionPresentacionRequest xmlns="decision/v1"><productId>x</productId><presentationIds>${items}</presentationIds></simulacionPresentacionRequest>`;
    expect(cuerpoXmlADto(lista('<item>a</item><item>b</item><item>c</item>'), PRESENTACION).presentationIds).toEqual(['a', 'b', 'c']);
    expect(cuerpoXmlADto(lista('<item>a</item>'), PRESENTACION).presentationIds).toEqual(['a']);
    expect(cuerpoXmlADto(lista(''), PRESENTACION).presentationIds).toEqual([]);
    // Un hijo que no es <item> no se convierte: el DTO lo rechaza por no ser arreglo.
    expect(Array.isArray(cuerpoXmlADto(lista('<otro>a</otro>'), PRESENTACION).presentationIds)).toBe(false);
  });

  it('una raíz vacía da un cuerpo vacío (el DTO reporta los campos faltantes)', () => {
    expect(cuerpoXmlADto('<simulacionPrecioRequest xmlns="decision/v1"/>', PRECIO)).toEqual({});
  });

  it.each([
    ['vacío', '   ', /vacío/],
    ['mal formado', precio('<newPrice>1</newPrecio>'), /mal formado/],
    ['texto sin XML', 'newPrice=25', /mal formado|raíz/],
    ['DOCTYPE', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>' + precio('<newPrice>&e;</newPrice>'), /DOCTYPE/],
    ['ENTITY suelta', precio('<!ENTITY e "x"><newPrice>1</newPrice>'), /DOCTYPE ni ENTITY/],
    ['otra raíz', '<simulacionPresentacionRequest xmlns="decision/v1"/>', /raíz del XML debe ser <simulacionPrecioRequest>, llegó <simulacionPresentacionRequest>/],
    ['sin namespace', '<simulacionPrecioRequest><newPrice>1</newPrice></simulacionPrecioRequest>', /falta xmlns/],
    ['otro namespace', '<simulacionPrecioRequest xmlns="pricing/v1"/>', /llegó "pricing\/v1"/],
    ['prefijo con otro namespace', '<d:simulacionPrecioRequest xmlns="decision/v1" xmlns:d="otro"/>', /llegó "otro"/],
    ['texto en la raíz', '<simulacionPrecioRequest xmlns="decision/v1">25</simulacionPrecioRequest>', /elementos/],
  ])('rechaza con 400: %s', (_caso, xml, esperado) => {
    expect(motivo(() => cuerpoXmlADto(xml, PRECIO))).toMatch(esperado);
  });
});

describe('tipoDeContenido', () => {
  it('quita parámetros y normaliza', () => {
    expect(tipoDeContenido('Application/XML; charset=utf-8')).toBe('application/xml');
    expect(tipoDeContenido(undefined)).toBeNull();
    expect(tipoDeContenido('')).toBeNull();
  });
});

describe('CuerpoXmlInterceptor', () => {
  const siguiente = { handle: () => of('respuesta') };

  function contexto(contentType: string | undefined, body: unknown) {
    const req = { headers: contentType ? { 'content-type': contentType } : {}, body };
    return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as never };
  }

  it('JSON o sin Content-Type: no toca el cuerpo', async () => {
    for (const ct of ['application/json', 'application/json; charset=utf-8', undefined]) {
      const cuerpo = { newPrice: 1 };
      const { req, ctx } = contexto(ct, cuerpo);
      await expect(lastValueFrom(new CuerpoXmlInterceptor(PRECIO).intercept(ctx, siguiente))).resolves.toBe('respuesta');
      expect(req.body).toBe(cuerpo);
    }
  });

  it('XML: reemplaza el cuerpo por el objeto convertido', async () => {
    const { req, ctx } = contexto('text/xml', precio('<newPrice>2</newPrice>'));
    await lastValueFrom(new CuerpoXmlInterceptor(PRECIO).intercept(ctx, siguiente));
    expect(req.body).toEqual({ newPrice: 2 });
  });

  it('otro Content-Type → 415', () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const { ctx } = contexto(ct, {});
      expect(() => new CuerpoXmlInterceptor(PRECIO).intercept(ctx, siguiente)).toThrow(UnsupportedMediaTypeException);
    }
  });

  it('XML sin cuerpo (body-parser deja el objeto vacío) → 400', () => {
    const { ctx } = contexto('application/xml', {});
    expect(() => new CuerpoXmlInterceptor(PRECIO).intercept(ctx, siguiente)).toThrow(/vacío/);
  });
});
