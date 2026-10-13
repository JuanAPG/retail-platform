import { crearMiddlewareCuerpoXml } from './xml-body.middleware';

function correr(cuerpo: string, contentType = 'application/xml') {
  const Mw = crearMiddlewareCuerpoXml('notificacionRequest');
  const req: any = {
    headers: { 'content-type': contentType, 'content-length': String(Buffer.byteLength(cuerpo)) },
    method: 'POST',
    body: undefined,
    _body: false,
    on: jest.fn(),
  };
  // `express.text` lee del stream: se simula con un Readable.
  const { Readable } = require('stream');
  const stream = Readable.from([Buffer.from(cuerpo)]);
  Object.assign(stream, { headers: req.headers, method: 'POST', body: undefined });
  return new Promise<{ req: any; error?: unknown }>((resolve) => {
    new Mw().use(stream as never, {} as never, (error?: unknown) => resolve({ req: stream, error }));
  });
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<notificacionRequest xmlns="notif/v1">
  <eventType>precio.umbral</eventType>
  <sourceService>pricing-service</sourceService>
  <relatedEntityId>pres-1</relatedEntityId>
  <title>Precio fuera de rango</title>
  <message>A &amp; B &lt; C</message>
  <priority>warning</priority>
</notificacionRequest>`;

describe('XmlBodyMiddleware', () => {
  it('convierte notificacionRequest en el mismo objeto que el JSON', async () => {
    const { req, error } = await correr(XML);
    expect(error).toBeUndefined();
    expect(req.body).toEqual({
      eventType: 'precio.umbral',
      sourceService: 'pricing-service',
      relatedEntityId: 'pres-1',
      title: 'Precio fuera de rango',
      message: 'A & B < C',
      priority: 'warning',
    });
  });

  it('rechaza una raíz distinta (400)', async () => {
    const { error } = await correr('<otra><eventType>x</eventType></otra>');
    expect(error).toMatchObject({ status: 400 });
  });

  it('rechaza XML mal formado (400)', async () => {
    const { error } = await correr('<notificacionRequest><title>x</notificacionRequest>');
    expect(error).toMatchObject({ status: 400 });
  });

  it('rechaza DOCTYPE/ENTITY (400)', async () => {
    const { error } = await correr(
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><notificacionRequest><title>&a;</title></notificacionRequest>',
    );
    expect(error).toMatchObject({ status: 400 });
  });

  it('con JSON no toca el cuerpo', async () => {
    const { req, error } = await correr('{"a":1}', 'application/json');
    expect(error).toBeUndefined();
    // body-parser deja `{}` si no es su tipo; lo importante es que no lo parseó como XML.
    expect(typeof req.body).not.toBe('string');
    expect(req.body?.eventType).toBeUndefined();
  });
});
