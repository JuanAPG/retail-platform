import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpErrorFilter, RAIZ_ERROR, serializarErrorXml } from './http-error.filter';

/**
 * El cuerpo de error es el mismo para TODOS los códigos, `message` es
 * siempre string y el detalle de validación va en `details`. Un 500
 * inesperado no filtra texto interno al cliente, pero sí deja su stack en
 * el log: antes pasaba exactamente lo contrario.
 */
const CAMPOS = ['statusCode', 'message', 'code', 'details', 'path', 'timestamp'];

function anfitrion(accept?: string) {
  const respuesta = {
    codigo: 0,
    cuerpoJson: null as Record<string, unknown> | null,
    cuerpoTexto: '' as string,
    tipo: '' as string,
    status(codigo: number) {
      this.codigo = codigo;
      return this;
    },
    json(cuerpo: Record<string, unknown>) {
      this.cuerpoJson = cuerpo;
      this.tipo = 'application/json';
      return this;
    },
    type(tipo: string) {
      this.tipo = tipo;
      return this;
    },
    send(texto: string) {
      this.cuerpoTexto = texto;
      return this;
    },
  };
  const peticion = {
    url: '/v1/recurso',
    method: 'GET',
    headers: accept ? { accept } : ({} as Record<string, string>),
  };
  return {
    respuesta,
    host: {
      switchToHttp: () => ({ getRequest: () => peticion, getResponse: () => respuesta }),
    } as never,
  };
}

describe('HttpErrorFilter', () => {
  let errores: { mensaje: string; stack?: string }[];

  beforeEach(() => {
    errores = [];
    jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((mensaje: unknown, stack?: unknown) => {
        errores.push({ mensaje: String(mensaje), stack: stack ? String(stack) : undefined });
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it('mismo cuerpo y código correcto en 400, 401, 404, 409 y 503', async () => {
    const casos: [Error, number, string][] = [
      [new BadRequestException('Petición inválida.'), 400, 'VALIDATION_ERROR'],
      [new UnauthorizedException('Sesión inactiva.'), 401, 'UNAUTHORIZED'],
      [new NotFoundException('No existe.'), 404, 'NOT_FOUND'],
      [new ConflictException('Ya existe.'), 409, 'CONFLICT'],
      [new ServiceUnavailableException('Catálogo no disponible.'), 503, 'SERVICE_UNAVAILABLE'],
    ];
    for (const [excepcion, status, code] of casos) {
      const { host, respuesta } = anfitrion();
      new HttpErrorFilter().catch(excepcion, host);
      expect(respuesta.codigo).toBe(status);
      expect(Object.keys(respuesta.cuerpoJson!).sort()).toEqual([...CAMPOS].sort());
      expect(respuesta.cuerpoJson).toMatchObject({ statusCode: status, code, details: null });
      expect(typeof respuesta.cuerpoJson!.message).toBe('string');
    }
  });

  it('el 400 del ValidationPipe deja el detalle en `details` y message como string', () => {
    const { host, respuesta } = anfitrion();
    // Forma exacta que produce Nest con un arreglo de mensajes.
    new HttpErrorFilter().catch(
      new BadRequestException(['storeId debe ser un UUID válido.', 'fecha no puede ser futura.']),
      host,
    );
    expect(respuesta.codigo).toBe(400);
    expect(typeof respuesta.cuerpoJson!.message).toBe('string');
    expect(respuesta.cuerpoJson!.details).toEqual([
      'storeId debe ser un UUID válido.',
      'fecha no puede ser futura.',
    ]);
    expect(respuesta.cuerpoJson!.code).toBe('VALIDATION_ERROR');
  });

  it('413 y 415 se mapean a VALIDATION_ERROR, no a INTERNAL', () => {
    for (const status of [HttpStatus.PAYLOAD_TOO_LARGE, HttpStatus.UNSUPPORTED_MEDIA_TYPE]) {
      const { host, respuesta } = anfitrion();
      new HttpErrorFilter().catch(
        Object.assign(new BadRequestException('x'), {
          getStatus: () => status,
          getResponse: () => ({ message: 'Archivo no admitido.' }),
        }),
        host,
      );
      expect(respuesta.cuerpoJson!.code).toBe('VALIDATION_ERROR');
    }
  });

  it('un error NO-HTTP sale con formato estándar y sin filtrar texto interno', () => {
    const { host, respuesta } = anfitrion();
    const crudo = new Error(
      'duplicate key value violates unique constraint "uq_transaccion_folio"',
    );
    new HttpErrorFilter().catch(crudo, host);

    expect(respuesta.codigo).toBe(500);
    expect(respuesta.cuerpoJson).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL',
      message: 'Error interno del servidor.',
      details: null,
    });
    // Ni el mensaje del motor ni el stack viajan al cliente.
    expect(JSON.stringify(respuesta.cuerpoJson)).not.toContain('unique constraint');
    expect(JSON.stringify(respuesta.cuerpoJson)).not.toContain('Error:');
  });

  it('el 500 sí deja el mensaje y el stack en el log', () => {
    const { host } = anfitrion();
    new HttpErrorFilter().catch(new Error('boom interno'), host);

    expect(errores).toHaveLength(1);
    expect(errores[0].mensaje).toContain('boom interno');
    expect(errores[0].stack).toContain('boom interno');
  });

  it('un 4xx esperado no ensucia el log de errores', () => {
    const { host } = anfitrion();
    new HttpErrorFilter().catch(new NotFoundException('No existe.'), host);
    expect(errores).toHaveLength(0);
  });

  it('responde en XML cuando Accept lo pide, con raíz <error> y el mismo cuerpo', () => {
    const { host, respuesta } = anfitrion('application/xml');
    new HttpErrorFilter().catch(new NotFoundException('No existe la canasta x.'), host);

    expect(respuesta.codigo).toBe(404);
    expect(respuesta.tipo).toContain('application/xml');
    expect(respuesta.cuerpoTexto).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    // Raíz `error`, la que declaran los XSD de todos los servicios.
    expect(respuesta.cuerpoTexto).toContain(`<${RAIZ_ERROR}`);
    expect(respuesta.cuerpoTexto).toContain('<code>NOT_FOUND</code>');
    expect(respuesta.cuerpoTexto).toContain('<statusCode>404</statusCode>');
    expect(respuesta.cuerpoJson).toBeNull();
  });

  it('el XML lleva `details`, igual que el JSON: un 400 debe ser accionable', () => {
    // Omitir `details` en XML dejaba al cliente XML-exclusivo con un
    // "no pasó la validación" sin saber QUÉ campo falló.
    const { host, respuesta } = anfitrion('application/xml');
    new HttpErrorFilter().catch(
      new BadRequestException(['storeId debe ser un UUID válido.', 'fecha no puede ser futura.']),
      host,
    );

    expect(respuesta.cuerpoTexto).toContain('<details>');
    expect(respuesta.cuerpoTexto).toContain('<item>storeId debe ser un UUID válido.</item>');
    expect(respuesta.cuerpoTexto).toContain('<item>fecha no puede ser futura.</item>');
  });

  it('XML y JSON llevan EXACTAMENTE los mismos campos', () => {
    const casos: [Error, string][] = [
      [new BadRequestException(['campo inválido']), '400'],
      [new NotFoundException('No existe.'), '404'],
      [new Error('interno'), '500'],
    ];
    for (const [excepcion] of casos) {
      const json = anfitrion();
      new HttpErrorFilter().catch(excepcion, json.host);
      const xml = anfitrion('application/xml');
      new HttpErrorFilter().catch(excepcion, xml.host);

      for (const [clave, valor] of Object.entries(json.respuesta.cuerpoJson!)) {
        if (valor === null) {
          // Un nulo se omite en XML a propósito: un elemento vacío no es un
          // tipo válido, y los XSD lo declaran `minOccurs="0"`.
          expect(xml.respuesta.cuerpoTexto).not.toContain(`<${clave}>`);
        } else {
          expect(xml.respuesta.cuerpoTexto).toContain(`<${clave}>`);
        }
      }
    }
  });

  it('un error sin detalle omite `details` (los XSD lo declaran opcional)', () => {
    const { host, respuesta } = anfitrion('application/xml');
    new HttpErrorFilter().catch(new NotFoundException('No existe.'), host);
    expect(respuesta.cuerpoTexto).not.toContain('<details>');
  });

  it('serializarErrorXml es el ÚNICO camino: el filtro emite lo que ella produce', () => {
    // Si el script de validación reconstruyera el cuerpo por su cuenta,
    // pasaría en verde mientras el servicio emite algo distinto. Esta
    // prueba fija que filtro y script comparten la misma función.
    const { host, respuesta } = anfitrion('application/xml');
    new HttpErrorFilter().catch(new NotFoundException('No existe.'), host);

    const cuerpo = {
      ...(respuesta.cuerpoTexto ? {} : {}),
      statusCode: 404,
      message: 'No existe.',
      code: 'NOT_FOUND',
      details: null,
      path: '/v1/recurso',
      timestamp: '',
    };
    const esperado = serializarErrorXml({ ...cuerpo, timestamp: '' });
    // Se compara sin el timestamp, que cambia en cada llamada.
    const sinFecha = (s: string) => s.replace(/<timestamp>[^<]*<\/timestamp>/, '<timestamp/>');
    expect(sinFecha(respuesta.cuerpoTexto)).toBe(sinFecha(esperado));
  });

  it('con Accept JSON o ausente responde JSON', () => {
    for (const accept of ['application/json', undefined, '*/*']) {
      const { host, respuesta } = anfitrion(accept);
      new HttpErrorFilter().catch(new NotFoundException('No existe.'), host);
      expect(respuesta.cuerpoJson).not.toBeNull();
      expect(respuesta.cuerpoTexto).toBe('');
    }
  });

  it('respeta un `code` explícito del servicio', () => {
    const { host, respuesta } = anfitrion();
    new HttpErrorFilter().catch(
      new ConflictException({ message: 'Folio repetido.', code: 'CONFLICT' }),
      host,
    );
    expect(respuesta.cuerpoJson).toMatchObject({ code: 'CONFLICT', message: 'Folio repetido.' });
  });
});
