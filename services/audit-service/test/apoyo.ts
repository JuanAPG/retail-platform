/**
 * Validación de XML contra `docs/contratos/audit-service.xsd` para las
 * pruebas de integración.
 *
 * Mismo mecanismo que `services/decision-service/test/apoyo.ts`: se usa
 * `xmllint` si está en el PATH y, si no, Python 3 con `lxml`. Antes esta
 * validación llamaba a `xmllint` a secas y en Windows reventaba con
 * `spawnSync xmllint ENOENT` (fallos 8 y 9 de la corrida del 13-oct-2026),
 * así que la validación XML de audit-service se quedó sin verificar en toda
 * la entrega. El XML no tenía nada malo: lo que faltaba era el binario.
 *
 * Si no hay ninguno de los dos, la prueba **falla** diciendo qué instalar.
 * No se omite: una validación de contrato que se salta en silencio es peor
 * que una que falla.
 */
import { spawnSync } from 'child_process';
import { resolve } from 'path';

export const XSD = resolve(__dirname, '../../../docs/contratos/audit-service.xsd');

/** Nombre del elemento raíz del documento (sin prefijo de namespace). */
export function raizXml(xml: string): string | null {
  const sinProlog = xml.replace(/^\s*<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  return /^\s*<(?:[\w.-]+:)?([\w.-]+)/.exec(sinProlog)?.[1] ?? null;
}

const VALIDAR_CON_LXML = `
import sys
from lxml import etree
esquema = etree.XMLSchema(etree.parse(sys.argv[1]))
documento = etree.fromstring(sys.stdin.buffer.read())
if not esquema.validate(documento):
    print("\\n".join(str(e) for e in esquema.error_log))
    sys.exit(1)
`;

type Validador = { nombre: string; validar: (xml: string) => { ok: boolean; salida: string } };

let validador: Validador | undefined;

function corre(comando: string, args: string[], entrada?: string) {
  const r = spawnSync(comando, args, { input: entrada, encoding: 'utf8' });
  // `r.error` cubre el ENOENT de un binario que no existe: sin esto, un
  // comando ausente se veía igual que un documento inválido.
  return { ok: !r.error && r.status === 0, salida: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/**
 * xmllint si está en el PATH; si no, Python con lxml. En Windows `python3`
 * puede ser otro intérprete sin lxml (MSYS), así que también se prueba
 * `python` y `py`. Sin ninguno, FALLA diciendo qué instalar.
 */
export function validadorXsd(): Validador {
  if (validador) return validador;
  if (corre('xmllint', ['--version']).ok) {
    validador = {
      nombre: 'xmllint',
      validar: (xml) => corre('xmllint', ['--noout', '--schema', XSD, '-'], xml),
    };
    return validador;
  }
  const python = ['python3', 'python', 'py'].find((p) => corre(p, ['-c', 'import lxml']).ok);
  if (python) {
    validador = {
      nombre: `${python} + lxml`,
      validar: (xml) => corre(python, ['-c', VALIDAR_CON_LXML, XSD], xml),
    };
    return validador;
  }
  throw new Error(
    'No hay con qué validar el XML contra el XSD. Instala xmllint (libxml2-utils en Debian/Ubuntu, ' +
      '`choco install xsltproc` en Windows, `brew install libxml2` en macOS) o Python 3 con lxml (`pip install lxml`).',
  );
}

/**
 * Falla si la raíz no es la esperada o si el XML no valida contra el XSD.
 *
 * Lanza con la salida del validador incluida, a propósito: el
 * `expect(...).not.toThrow()` que había antes reportaba solo
 * `Error name: "Error"` y no decía qué elemento del XSD se incumplía.
 */
export function esperarXmlValido(xml: string, raizEsperada: string): void {
  expect(raizXml(xml)).toBe(raizEsperada);
  const { ok, salida } = validadorXsd().validar(xml);
  if (!ok) {
    throw new Error(`El XML de <${raizEsperada}> no valida contra audit-service.xsd:\n${salida}\n--- XML ---\n${xml}`);
  }
}
