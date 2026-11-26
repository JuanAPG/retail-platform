import { readFileSync } from 'fs';
import { join } from 'path';
import { XMLParser } from 'fast-xml-parser';
import { serializarErrorXml } from '../common/filters/http-error.filter';
import { loteDesdeXml } from './xml/cuerpo-lote.middleware';
import { RUTA_XSD, ValidadorXsd } from './xml/validador-xsd';
import { acuseEjemplo, cuerpoError, ejemploXml, listaEjemplo, loteEjemplo, reenvioEjemplo } from './swagger/ejemplos';

/**
 * El contrato manda: la copia del XSD que viaja con el servicio es idéntica a
 * la de docs/contratos/, y todo XML que emite o documenta el servicio valida.
 */

const XSD_CONTRATO = join(__dirname, '..', '..', '..', '..', 'docs', 'contratos', 'offline-sync-service.xsd');
const MD_CONTRATO = join(__dirname, '..', '..', '..', '..', 'docs', 'contratos', 'offline-sync-service.md');

describe('contrato', () => {
  const validador = new ValidadorXsd();
  process.env.XML_NAMESPACE = 'sync/v1';

  it('la copia del XSD es idéntica a docs/contratos/offline-sync-service.xsd', () => {
    expect(readFileSync(RUTA_XSD, 'utf8')).toBe(readFileSync(XSD_CONTRATO, 'utf8'));
  });

  it.each([
    ['acuse (primer envío)', acuseEjemplo, 'acuseLote'],
    ['acuse (reenvío con originalStatus)', reenvioEjemplo, 'acuseLote'],
    ['listado', listaEjemplo, 'loteListResponse'],
    ['lote (petición del escritorio)', { ...loteEjemplo, client: 'escritorio' }, 'loteSync'],
  ])('el ejemplo XML de Swagger de %s valida contra el XSD', async (_n, ejemplo, raiz) => {
    expect(await validador.errores(ejemploXml(ejemplo, raiz))).toEqual([]);
  });

  it.each([400, 401, 403, 404, 409, 413, 503])('el error %i en XML valida contra el XSD', async (status) => {
    expect(await validador.errores(serializarErrorXml(cuerpoError(status)))).toEqual([]);
  });

  it('los ejemplos XML del contrato (.md) validan con el validador del servicio', async () => {
    const md = readFileSync(MD_CONTRATO, 'utf8');
    const bloques = [...md.matchAll(/```xml\n([\s\S]*?)```/g)].map((m) => m[1]).filter((x) => x.includes('xmlns="sync/v1"'));
    expect(bloques.length).toBeGreaterThanOrEqual(4);
    for (const xml of bloques) expect(await validador.errores(xml)).toEqual([]);
  });

  it('el XSD rechaza una captura sin zona horaria y un tipo pendiente (visita_campo)', async () => {
    const xml = ejemploXml(loteEjemplo, 'loteSync');
    expect((await validador.errores(xml.replace('09:30:00-06:00', '09:30:00'))).join()).toContain('capturedAt');
    expect((await validador.errores(xml.replace('<type>disponibilidad</type>', '<type>visita_campo</type>'))).length).toBeGreaterThan(0);
  });

  it('el lote XML se convierte al mismo objeto que el lote JSON', () => {
    const xml = ejemploXml(loteEjemplo, 'loteSync');
    const arbol = new XMLParser({
      ignoreAttributes: true,
      removeNSPrefix: true,
      parseTagValue: false,
      trimValues: true,
      isArray: (_n, ruta) => ruta === 'loteSync.captures.item',
    }).parse(xml);
    expect(loteDesdeXml(arbol)).toEqual(loteEjemplo);
  });
});
