import { XMLBuilder, XMLParser } from 'fast-xml-parser';

/**
 * XML de los servicios: leerlo, comprobar su raíz y su namespace, y armar cuerpos XML.
 *
 * Qué se valida EN EJECUCIÓN (cada respuesta):
 *  - Que sea XML bien formado y sin DOCTYPE/ENTITY.
 *  - Que la raíz sea la que declara el XSD del contrato para esa ruta, y que el namespace
 *    sea el del servicio (`auth/v1`, `algorithms/v1`, …).
 *  - Que un `<error>` traiga statusCode, message, code, path y timestamp.
 * La validación COMPLETA contra el XSD (tipos, orden, obligatorios) se hace en las pruebas
 * (`test/xsd.test.ts`, con libxml2), para no cargar un validador de 2 MB en la ventana.
 *
 * Rarezas que resuelven las ayudas de abajo (vienen del XmlInterceptor de los servicios):
 *  - Todo arreglo llega como <x><item>..</item><item>..</item></x>.
 *  - Con UN solo elemento el parser entrega un objeto, no una lista.
 *  - Una lista vacía o un nulo llegan como elemento vacío y el parser los entrega como ''.
 *  - Los valores llegan como texto (no se convierten solos: un SKU "007" no debe volverse 7).
 */

/** Namespace del XML de cada servicio (XML_NAMESPACE en infra/docker-compose.yml y targetNamespace del XSD). */
export const NAMESPACE = {
  auth: 'auth/v1',
  catalog: 'catalog/v1',
  algorithms: 'algorithms/v1',
  decision: 'decision/v1',
  documents: 'documents/v1',
  ingestion: 'ingestion/v1',
  segmentation: 'segmentation/v1',
} as const;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export class XmlInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'XmlInvalidoError';
  }
}

export interface DocumentoXml {
  raiz: string;
  /** Namespace por defecto de la raíz ('' si no trae). */
  namespace: string;
  /** Contenido de la raíz ya convertido a objeto ('' si la raíz está vacía). */
  cuerpo: any;
}

/** Raíz (sin prefijo) y su namespace, leídos de la etiqueta de apertura. */
function raizYNamespace(texto: string): { raiz: string; namespace: string } {
  const sinPrologo = texto
    .replace(/^﻿/, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const apertura = /<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)([^>]*)>/.exec(sinPrologo);
  if (!apertura) throw new XmlInvalidoError('La respuesta no trae ningún elemento XML.');
  const [, prefijo, raiz, atributos] = apertura;
  const atributo = prefijo ? `xmlns:${prefijo.slice(0, -1)}` : 'xmlns';
  const ns = new RegExp(`\\s${atributo.replace(':', '\\:')}\\s*=\\s*["']([^"']*)["']`).exec(atributos);
  return { raiz, namespace: ns ? ns[1] : '' };
}

/** Lee un documento XML. Lanza XmlInvalidoError si no es XML bien formado o trae DOCTYPE/ENTITY. */
export function leerXml(texto: string): DocumentoXml {
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) throw new XmlInvalidoError('El XML trae DOCTYPE o ENTITY; se rechaza.');
  const { raiz, namespace } = raizYNamespace(texto);
  let objeto: any;
  try {
    objeto = parser.parse(texto, true);
  } catch (e) {
    throw new XmlInvalidoError(`XML mal formado: ${(e as Error).message ?? e}`);
  }
  if (!objeto || !(raiz in objeto)) throw new XmlInvalidoError(`No se pudo leer la raíz <${raiz}>.`);
  return { raiz, namespace, cuerpo: objeto[raiz] };
}

/** Exige la raíz y el namespace del contrato. Devuelve el contenido de la raíz. */
export function exigirRaiz(doc: DocumentoXml, raiz: string, namespace: string): any {
  if (doc.raiz !== raiz) {
    throw new XmlInvalidoError(`Se esperaba <${raiz}> y llegó <${doc.raiz}> (revisa el contrato del servicio).`);
  }
  if (doc.namespace !== namespace) {
    throw new XmlInvalidoError(
      `<${raiz}> llegó con namespace "${doc.namespace || 'ninguno'}"; el contrato pide "${namespace}".`,
    );
  }
  return doc.cuerpo;
}

/** Cuerpo de error estándar: {statusCode, message, code, details, path, timestamp}. */
export interface CuerpoError {
  statusCode: number;
  message: string;
  code: string;
  details: string[];
  path: string;
  timestamp: string;
}

/** Lee un `<error>` y comprueba que traiga los campos obligatorios del XSD. */
export function errorDesdeXml(doc: DocumentoXml): CuerpoError {
  if (doc.raiz !== 'error') throw new XmlInvalidoError(`Se esperaba <error> y llegó <${doc.raiz}>.`);
  const c = doc.cuerpo || {};
  const faltan = ['statusCode', 'message', 'code', 'path', 'timestamp'].filter((k) => c[k] === undefined);
  if (faltan.length > 0) throw new XmlInvalidoError(`El <error> no trae: ${faltan.join(', ')}.`);
  return {
    statusCode: Number(c.statusCode),
    message: text(c.message),
    code: text(c.code),
    details: asList(c.details?.item).map(text),
    path: text(c.path),
    timestamp: text(c.timestamp),
  };
}

const builder = new XMLBuilder({
  format: true,
  indentBy: '  ',
  suppressEmptyNode: false,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true,
});

/** Quita nulos/indefinidos y convierte cada arreglo en una lista de <item>. */
function aNodos(valor: unknown): unknown {
  if (Array.isArray(valor)) return { item: valor.map(aNodos) };
  if (valor && typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) {
      if (v === null || v === undefined) continue;
      salida[k] = aNodos(v);
    }
    return salida;
  }
  return valor;
}

/**
 * Arma un documento XML con la raíz y el namespace del contrato. Los campos van en el orden
 * en que vienen en `datos` (el XSD usa `sequence` en varios cuerpos: respétalo al armarlo).
 */
export function construirXml(raiz: string, namespace: string, datos: Record<string, unknown>): string {
  const contenido = aNodos(datos) as Record<string, unknown>;
  const xml = builder.build({ [raiz]: { '@_xmlns': namespace, ...contenido } }) as string;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

// ---------------------------------------------------------------------------------------
// Ayudas de lectura
// ---------------------------------------------------------------------------------------

/** Convierte lo que haya (undefined, '', objeto suelto o lista) en una lista de verdad. */
export function asList<T = any>(node: unknown): T[] {
  if (node === undefined || node === null || node === '') return [];
  return Array.isArray(node) ? (node as T[]) : [node as T];
}

/** '' (nulo en XML) y undefined pasan a null; lo demás se devuelve igual. */
export function nullIfEmpty<T>(value: T | '' | undefined | null): T | null {
  return value === '' || value === undefined || value === null ? null : value;
}

/** Texto seguro: null/undefined pasan a ''. */
export function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

export function textOrNull(value: unknown): string | null {
  const v = nullIfEmpty(value as any);
  return v === null ? null : text(v);
}

/** Booleano tolerante: el parser entrega 'true'/'false' como texto. */
export function bool(value: unknown): boolean {
  return value === true || value === 'true';
}

export function boolOrNull(value: unknown): boolean | null {
  const v = nullIfEmpty(value as any);
  return v === null ? null : bool(v);
}

export function num(value: unknown): number {
  return Number(value);
}

export function numberOrNull(value: unknown): number | null {
  const v = nullIfEmpty(value as any);
  if (v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
