/**
 * Cuerpos XML en POST /v1/simulation/price y /presentation contra el
 * servicio REAL (auth-service, Redis y Postgres de verdad). No crea datos:
 * los casos válidos usan UUID que no existen, así que el XML se lee, pasa la
 * validación y llega al servicio, que responde 404 sin guardar nada. El caso
 * que sí guarda un escenario desde XML está en `contrato-xml.spec.ts`.
 *
 *   docker compose -f infra/docker-compose.yml up -d postgres redis auth-service decision-service
 *   npm run test:integracion
 * y xmllint o Python 3 con lxml para validar (ver `apoyo.ts`).
 */
import { randomUUID } from 'crypto';
import { CUENTAS, entrar, esperarXmlValido, http, validadorXsd } from './apoyo';
import { EJEMPLO_XML_PRECIO, EJEMPLO_XML_PRESENTACION } from '../src/simulation/simulation.controller';

const XML = 'application/xml';
const comoXml = (texto: string) => ({ crudo: { texto, tipo: XML }, accept: XML });

function valor(xml: string, etiqueta: string): string | undefined {
  return new RegExp(`<${etiqueta}>([^<]*)</${etiqueta}>`).exec(xml)?.[1];
}

/** El ejemplo del contrato con UUID nuevos (que no existen en la base). */
function precioInexistente(): string {
  return EJEMPLO_XML_PRECIO.replace(/<presentationId>[^<]*/, `<presentationId>${randomUUID()}`).replace(
    /<zoneId>[^<]*/,
    `<zoneId>${randomUUID()}`,
  );
}

describe('Cuerpo XML en simulación (integración)', () => {
  let planeador: string;
  let analista: string;

  beforeAll(async () => {
    validadorXsd();
    [planeador, analista] = await Promise.all([entrar(CUENTAS.Planeador), entrar(CUENTAS.Analista)]);
  });

  it('los XML de ejemplo validan contra el XSD oficial', () => {
    esperarXmlValido(EJEMPLO_XML_PRECIO, 'simulacionPrecioRequest');
    esperarXmlValido(EJEMPLO_XML_PRESENTACION, 'simulacionPresentacionRequest');
  });

  it('price en XML válido llega al servicio igual que el JSON (404 sin datos, en XML válido)', async () => {
    const xml = precioInexistente();
    const rx = await http('POST', '/v1/simulation/price', planeador, comoXml(xml));
    expect(rx.estado).toBe(404);
    esperarXmlValido(rx.texto, 'error');

    const cuerpo = {
      presentationId: /<presentationId>([^<]*)/.exec(xml)![1],
      zoneId: /<zoneId>([^<]*)/.exec(xml)![1],
      newPrice: 25.5,
    };
    const rj = await http('POST', '/v1/simulation/price', planeador, { cuerpo });
    expect(rj.estado).toBe(404);
    expect(JSON.parse(rj.texto).message).toBe(valor(rx.texto, 'message'));
  });

  it('presentation en XML válido: la lista <item> pasa la validación (404: producto inexistente)', async () => {
    const xml = EJEMPLO_XML_PRESENTACION.replace(/<productId>[^<]*/, `<productId>${randomUUID()}`);
    const r = await http('POST', '/v1/simulation/presentation', planeador, comoXml(xml));
    expect(r.estado).toBe(404);
    esperarXmlValido(r.texto, 'error');
  });

  it.each([
    ['raíz equivocada', () => precioInexistente().replace(/simulacionPrecioRequest/g, 'simulacionRequest'), 400],
    ['namespace equivocado', () => precioInexistente().replace('decision/v1', 'pricing/v1'), 400],
    ['mal formado', () => precioInexistente().replace('</newPrice>', ''), 400],
    ['con DOCTYPE', () => `<!DOCTYPE x [<!ENTITY e "y">]>\n${precioInexistente().replace(/^<\?xml[^>]*\?>\n/, '')}`, 400],
    ['de más de 1 MB', () => precioInexistente().replace('<newPrice>', `<!--${'x'.repeat(1024 * 1024)}--><newPrice>`), 413],
  ])('XML %s → error transversal en XML', async (_caso, armar, estado) => {
    const r = await http('POST', '/v1/simulation/price', planeador, comoXml(armar()));
    expect(r.estado).toBe(estado);
    esperarXmlValido(r.texto, 'error');
    expect(valor(r.texto, 'code')).toBe('VALIDATION_ERROR');
  });

  it('Content-Type no soportado → 415', async () => {
    const r = await http('POST', '/v1/simulation/price', planeador, { crudo: { texto: 'newPrice=1', tipo: 'text/plain' }, accept: XML });
    expect(r.estado).toBe(415);
    esperarXmlValido(r.texto, 'error');
  });

  it('JSON sigue igual: cuerpo vacío → el 400 de validación de siempre', async () => {
    const r = await http('POST', '/v1/simulation/price', planeador, { cuerpo: {} });
    expect(r.estado).toBe(400);
    expect(JSON.parse(r.texto).details).toEqual(expect.arrayContaining(['presentationId must be a UUID']));
  });

  it('rol sin permiso (Analista) → 403 con XML', async () => {
    const r = await http('POST', '/v1/simulation/price', analista, comoXml(precioInexistente()));
    expect(r.estado).toBe(403);
    esperarXmlValido(r.texto, 'error');
  });

  it('sin sesión → 401 con XML', async () => {
    const r = await http('POST', '/v1/simulation/price', '', comoXml(precioInexistente()));
    expect(r.estado).toBe(401);
    esperarXmlValido(r.texto, 'error');
  });
});
