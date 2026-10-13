/**
 * Andamiaje común de las pruebas de integración de decision-service:
 * login real contra auth-service, conexión a la base local y validación
 * de XML contra `docs/contratos/decision-service.xsd`.
 */
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { DataSource } from 'typeorm';

export const BASE = process.env.DECISION_BASE_URL ?? 'http://localhost:3107';
export const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';
const CLAVE = process.env.DECISION_TEST_PASSWORD ?? 'Passw0rd123!';

export const XSD = resolve(__dirname, '../../../docs/contratos/decision-service.xsd');

/** Cuentas semilla (`db/data_retail.sql`), una por rol. */
export const CUENTAS = {
  Administrador: 'admin@retail.mx',
  Analista: 'analista@retail.mx',
  Gerente: 'gercategoria@retail.mx',
  'Responsable de precios': 'precios@retail.mx',
  Planeador: 'planeador@retail.mx',
  Auditor: 'auditor@retail.mx',
  Proveedor: 'contacto@bioorganicos.mx',
} as const;

/** Misma base que usa el stack local (credenciales de `infra/docker-compose.yml`). */
export function crearDb(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'retail_user',
    password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
    database: process.env.DB_NAME ?? 'retaildb',
  });
}

export async function entrar(email: string): Promise<string> {
  const r = await fetch(`${AUTH}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  const cuerpo = (await r.json()) as { accessToken?: string };
  if (!cuerpo.accessToken) {
    throw new Error(`No se pudo iniciar sesión como ${email} en ${AUTH} (HTTP ${r.status}): ¿está arriba auth-service con el seed?`);
  }
  return cuerpo.accessToken;
}

export interface Respuesta {
  estado: number;
  texto: string;
}

export async function http(
  metodo: string,
  ruta: string,
  token: string,
  opciones: { cuerpo?: object; accept?: string } = {},
): Promise<Respuesta> {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opciones.cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(opciones.accept ? { Accept: opciones.accept } : {}),
    },
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });
  return { estado: r.status, texto: await r.text() };
}

/** Nombre del elemento raíz del documento (sin prefijo). */
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
  return { ok: !r.error && r.status === 0, salida: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/**
 * xmllint si está en el PATH; si no, Python con lxml. En Windows `python3`
 * puede ser otro intérprete sin lxml (MSYS), así que también se prueba
 * `python` y `py`. Sin ninguno, la prueba FALLA diciendo qué instalar.
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

/** Falla si la raíz no es la esperada o si el XML no valida contra el XSD. */
export function esperarXmlValido(xml: string, raizEsperada: string): void {
  expect(raizXml(xml)).toBe(raizEsperada);
  const { ok, salida } = validadorXsd().validar(xml);
  if (!ok) {
    throw new Error(`El XML de <${raizEsperada}> no valida contra decision-service.xsd:\n${salida}\n--- XML ---\n${xml}`);
  }
}
