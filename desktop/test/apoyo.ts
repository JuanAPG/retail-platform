import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateXML } from 'xmllint-wasm';

/** Contratos oficiales (docs/contratos en la raíz del repositorio) y sus ejemplos XML. */
export const CONTRATOS = join(__dirname, '..', '..', 'docs', 'contratos');
export const EJEMPLOS_CONTRATO = join(CONTRATOS, 'ejemplos');
export const FIXTURES = join(__dirname, 'fixtures');

export const leer = (ruta: string) => readFileSync(ruta, 'utf8');
export const fixture = (nombre: string) => leer(join(FIXTURES, nombre));

/** XSD de cada servicio que consume el escritorio. */
export const XSD = {
  auth: join(CONTRATOS, 'auth-service.xsd'),
  catalog: join(CONTRATOS, 'catalog-service.xsd'),
  algorithms: join(CONTRATOS, 'algorithms-core.xsd'),
  decision: join(CONTRATOS, 'decision-service.xsd'),
  documents: join(CONTRATOS, 'documents-service.xsd'),
  segmentation: join(CONTRATOS, 'income-segmentation-service.xsd'),
  ingestion: join(CONTRATOS, 'transactions-ingestion-service.xsd'),
  promotion: join(CONTRATOS, 'promotion-service.xsd'),
  workflow: join(CONTRATOS, 'recommendations-workflow-service.xsd'),
} as const;

const BLOQUE_XML = new RegExp('```xml\\r?\\n([\\s\\S]*?)```', 'g');

/**
 * Bloques ```xml de un contrato (.md), con su raíz. Así las pruebas leen los ejemplos tal cual
 * están en el contrato, sin copiarlos.
 */
export function ejemplosXmlDelContrato(archivoMd: string): Array<{ raiz: string; xml: string }> {
  const md = leer(join(CONTRATOS, archivoMd));
  return [...md.matchAll(BLOQUE_XML)].map((m) => {
    const xml = m[1].trim();
    const sinPrologo = xml.replace(/<\?[\s\S]*?\?>/, '');
    const raiz = /<([A-Za-z_][\w.-]*)/.exec(sinPrologo)?.[1] ?? '';
    return { raiz, xml };
  });
}

/**
 * Valida un XML contra un XSD con libxml2 (xmllint compilado a WebAssembly). Devuelve la lista
 * de errores (vacía = válido). El XSD de ingesta incluye `xsd/error-transversal.xsd`: se precarga.
 */
export async function erroresXsd(xml: string, xsd: string): Promise<string[]> {
  const preload = xsd === XSD.ingestion
    ? [{ fileName: 'xsd/error-transversal.xsd', contents: leer(join(CONTRATOS, 'xsd', 'error-transversal.xsd')) }]
    : [];
  const r = await validateXML({
    xml: [{ fileName: 'documento.xml', contents: xml }],
    schema: [{ fileName: 'contrato.xsd', contents: leer(xsd) }],
    preload,
  });
  return r.valid ? [] : r.errors.map((e) => e.rawMessage.trim());
}
