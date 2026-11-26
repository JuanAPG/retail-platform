import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateXML } from 'xmllint-wasm';

/** Contratos de main (docs/contratos) y el de ingesta en revisión (copia en test/). */
export const CONTRATOS = join(__dirname, '..', '..', 'docs', 'contratos');
export const EN_REVISION = join(__dirname, 'contratos-en-revision');
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
  ingestion: join(EN_REVISION, 'transactions-ingestion-service.xsd'),
} as const;

/**
 * Valida un XML contra un XSD con libxml2 (xmllint compilado a WebAssembly). Devuelve la lista
 * de errores (vacía = válido). El XSD de ingesta incluye `xsd/error-transversal.xsd`: se precarga.
 */
export async function erroresXsd(xml: string, xsd: string): Promise<string[]> {
  const preload = xsd === XSD.ingestion
    ? [{ fileName: 'xsd/error-transversal.xsd', contents: leer(join(EN_REVISION, 'xsd', 'error-transversal.xsd')) }]
    : [];
  const r = await validateXML({
    xml: [{ fileName: 'documento.xml', contents: xml }],
    schema: [{ fileName: 'contrato.xsd', contents: leer(xsd) }],
    preload,
  });
  return r.valid ? [] : r.errors.map((e) => e.rawMessage.trim());
}
