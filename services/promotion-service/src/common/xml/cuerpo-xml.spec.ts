import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { CuerpoXmlInterceptor, cuerpoXmlADto, tipoDeContenido } from './cuerpo-xml';

const PRECIO = { raiz: 'promocionRequest', numeros: ['packPrice'] };
const LISTA = { raiz: 'otraRequest', listas: ['presentationIds'] };

function precio(contenido: string, apertura = '<promocionRequest xmlns="promotion/v1">', cierre = '</promocionRequest>') {
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
  it('convierte el XML al mismo objeto que el JSON (packPrice como número)', () => {
    const xml = precio('<presentationId>p</presentationId><zoneId>z</zoneId><packPrice>25.50</packPrice>');
    expect(cuerpoXmlADto(xml, PRECIO)).toEqual({ presentationId: 'p', zoneId: 'z', packPrice: 25.5 });
  });

  it('un número que no es xs:decimal se deja como texto para que el DTO lo rechace', () => {
    for (const valor of ['abc', '1e3', '', '25,5']) {
      const xml = precio(`<packPrice>${valor}</packPrice>`);
      expect(cuerpoXmlADto(xml, PRECIO).packPrice).toBe(valor);
    }
  });

  it('acepta la raíz con prefijo si el prefijo apunta al namespace del contrato', () => {
    const xml = precio('<d:packPrice>3</d:packPrice>', '<d:promocionRequest xmlns:d="promotion/v1">', '</d:promocionRequest>');
    expect(cuerpoXmlADto(xml, PRECIO)).toEqual({ packPrice: 3 });
  });

  it("acepta comillas simples y comentarios antes de la raíz", () => {
    const xml = `<!-- comentario --><promocionRequest xmlns='promotion/v1'><packPrice>1</packPrice></promocionRequest>`;
    expect(cuerpoXmlADto(xml, PRECIO)).toEqual({ packPrice: 1 });
  });

  it('ListaTexto: varios <item>, uno solo o la lista vacía pasan a arreglo', () => {
    const lista = (items: string) =>
      `<otraRequest xmlns="promotion/v1"><productId>x</productId><presentationIds>${items}</presentationIds></otraRequest>`;
    expect(cuerpoXmlADto(lista('<item>a</item><item>b</item><item>c</item>'), LISTA).presentationIds).toEqual(['a', 'b', 'c']);
    expect(cuerpoXmlADto(lista('<item>a</item>'), LISTA).presentationIds).toEqual(['a']);
    expect(cuerpoXmlADto(lista(''), LISTA).presentationIds).toEqual([]);
    // Un hijo que no es <item> no se convierte: el DTO lo rechaza por no ser arreglo.
    expect(Array.isArray(cuerpoXmlADto(lista('<otro>a</otro>'), LISTA).presentationIds)).toBe(false);
  });

  it('una raíz vacía da un cuerpo vacío (el DTO reporta los campos faltantes)', () => {
    expect(cuerpoXmlADto('<promocionRequest xmlns="promotion/v1"/>', PRECIO)).toEqual({});
  });

  it.each([
    ['vacío', '   ', /vacío/],
    ['mal formado', precio('<packPrice>1</newPrecio>'), /mal formado/],
    ['texto sin XML', 'packPrice=25', /mal formado|raíz/],
    ['DOCTYPE', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>' + precio('<packPrice>&e;</packPrice>'), /DOCTYPE/],
    ['ENTITY suelta', precio('<!ENTITY e "x"><packPrice>1</packPrice>'), /DOCTYPE ni ENTITY/],
    ['otra raíz', '<otraRequest xmlns="promotion/v1"/>', /raíz del XML debe ser <promocionRequest>, llegó <otraRequest>/],
    ['sin namespace', '<promocionRequest><packPrice>1</packPrice></promocionRequest>', /falta xmlns/],
    ['otro namespace', '<promocionRequest xmlns="pricing/v1"/>', /llegó "pricing\/v1"/],
    ['prefijo con otro namespace', '<d:promocionRequest xmlns="promotion/v1" xmlns:d="otro"/>', /llegó "otro"/],
    ['texto en la raíz', '<promocionRequest xmlns="promotion/v1">25</promocionRequest>', /elementos/],
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
      const cuerpo = { packPrice: 1 };
      const { req, ctx } = contexto(ct, cuerpo);
      await expect(lastValueFrom(new CuerpoXmlInterceptor(PRECIO).intercept(ctx, siguiente))).resolves.toBe('respuesta');
      expect(req.body).toBe(cuerpo);
    }
  });

  it('XML: reemplaza el cuerpo por el objeto convertido', async () => {
    const { req, ctx } = contexto('text/xml', precio('<packPrice>2</packPrice>'));
    await lastValueFrom(new CuerpoXmlInterceptor(PRECIO).intercept(ctx, siguiente));
    expect(req.body).toEqual({ packPrice: 2 });
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
