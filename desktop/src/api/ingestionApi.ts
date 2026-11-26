import { pedir } from './httpClient';
import { NAMESPACE, XmlInvalidoError, asList, construirXml, leerXml, text, textOrNull } from './xml';

/*
 * transactions-ingestion-service (3111, D-33/D-34). SEGÚN CONTRATO EN REVISIÓN (PR #96, rama
 * docs/contratos-ingestion-monitoring): transactions-ingestion-service.md / .xsd, namespace
 * ingestion/v1. El servicio todavía no existe en ninguna rama: esto se probó contra el contrato
 * y sus ejemplos, no contra el servicio.
 *
 * Dos cosas distintas que el contrato separa:
 *  1. El ARCHIVO de ventas: los datos (CSV, JSON o XML `salesFile`). Viaja como adjunto, en la
 *     parte binaria `file` de un multipart (POST /v1/transaction-imports). El servidor lo guarda
 *     tal cual y calcula su SHA-256 sobre los bytes originales.
 *  2. El MENSAJE de control de importación: lo que le dice al servicio qué hacer con un lote.
 *     - `objectImport` (XML): "importa el objeto X, generación G, del bucket privado"
 *       (POST /v1/transaction-imports/from-object). Este SÍ viaja como cuerpo XML.
 *     - Confirmar (POST …/{id}/confirm, sin cuerpo, idempotente) y descartar (DELETE …/{id}).
 * La vista previa no crea ventas; confirmar sí (y repetirlo devuelve lo ya guardado).
 * Roles: el Analista comercial crea, confirma y descarta los suyos; otro rol → 403.
 */

export const LIMITE_BYTES = 8_388_608; // INGESTION_MAX_BYTES propuesto en el contrato
export const FORMATOS = ['csv', 'json', 'xml'] as const;

export type EstadoLote = 'vista_previa' | 'confirmando' | 'conciliacion' | 'confirmado' | 'descartado';
export type EstadoFila = 'valida' | 'repetida' | 'rechazada' | 'conflicto';

export const NOMBRE_ESTADO_LOTE: Record<string, string> = {
  vista_previa: 'Vista previa',
  confirmando: 'Confirmando',
  conciliacion: 'En conciliación',
  confirmado: 'Confirmado',
  descartado: 'Descartado',
};

export interface Conteos {
  valid: number;
  repeated: number;
  rejected: number;
  conflicts: number;
  inserted: number;
}

export interface LoteImportacion {
  id: string;
  state: string;
  format: string;
  sha256: string;
  sizeBytes: number;
  createdAt: string;
  counts: Conteos;
}

export interface FilaImportacion {
  row: number;
  status: string;
  code: string | null;
  message: string | null;
}

/** Una línea del archivo de ventas (columnas del legado, contrato §Archivos). */
export interface LineaVenta {
  folio: string;
  fecha: string;
  tienda: string;
  sku: string;
  presentacion: string;
  cantidad: number;
  precio: number;
}

export function parseLote(r: any): LoteImportacion {
  const c = r?.counts ?? {};
  return {
    id: text(r?.id),
    state: text(r?.state),
    format: text(r?.format),
    sha256: text(r?.sha256),
    sizeBytes: Number(r?.sizeBytes),
    createdAt: text(r?.createdAt),
    counts: {
      valid: Number(c.valid ?? 0),
      repeated: Number(c.repeated ?? 0),
      rejected: Number(c.rejected ?? 0),
      conflicts: Number(c.conflicts ?? 0),
      inserted: Number(c.inserted ?? 0),
    },
  };
}

export function parseLotes(r: any): { lotes: LoteImportacion[]; total: number } {
  return { lotes: asList(r?.data?.item).map(parseLote), total: Number(r?.total ?? 0) };
}

export function parseFilas(r: any): { filas: FilaImportacion[]; total: number } {
  return {
    filas: asList(r?.data?.item).map((f: any) => ({
      row: Number(f.row),
      status: text(f.status),
      code: textOrNull(f.code),
      message: textOrNull(f.message),
    })),
    total: Number(r?.total ?? 0),
  };
}

/**
 * Revisión local del archivo ANTES de subirlo: tamaño, extensión y, si es XML, que su raíz sea
 * `salesFile` en `ingestion/v1` y que no traiga DOCTYPE. El servidor vuelve a validar todo.
 * Devuelve el motivo del rechazo o null.
 */
export async function revisarArchivo(archivo: File): Promise<string | null> {
  if (archivo.size === 0) return 'El archivo está vacío.';
  if (archivo.size > LIMITE_BYTES) return `El archivo pesa ${archivo.size} bytes; el máximo es ${LIMITE_BYTES} (8 MB).`;
  const extension = archivo.name.split('.').pop()?.toLowerCase() ?? '';
  if (!(FORMATOS as readonly string[]).includes(extension)) return 'Solo se aceptan archivos .csv, .json o .xml.';
  if (extension === 'xml') return revisarXmlVentas(await archivo.text());
  return null;
}

export function revisarXmlVentas(texto: string): string | null {
  try {
    const doc = leerXml(texto);
    if (doc.raiz !== 'salesFile') return `El XML de ventas debe tener raíz <salesFile>, no <${doc.raiz}>.`;
    if (doc.namespace !== NAMESPACE.ingestion) return `El XML de ventas debe usar el namespace "${NAMESPACE.ingestion}".`;
    if (asList(doc.cuerpo?.rows?.item).length === 0) return 'El XML de ventas no trae filas (<rows><item>…).';
    return null;
  } catch (e) {
    return e instanceof XmlInvalidoError ? e.message : 'No se pudo leer el XML de ventas.';
  }
}

/** Arma un archivo de ventas XML (`salesFile`) con los campos en el orden del XSD. */
export function archivoVentasXml(lineas: LineaVenta[]): string {
  return construirXml('salesFile', NAMESPACE.ingestion, {
    rows: lineas.map((l) => ({
      folio: l.folio,
      fecha: l.fecha,
      tienda: l.tienda,
      sku: l.sku,
      presentacion: l.presentacion,
      cantidad: l.cantidad.toFixed(2),
      precio: l.precio.toFixed(2),
    })),
  });
}

/** 1) ARCHIVO de ventas como adjunto (multipart, parte `file`). Devuelve la vista previa. */
export async function subirArchivo(archivo: File): Promise<LoteImportacion> {
  const formData = new FormData();
  formData.append('file', archivo, archivo.name);
  return parseLote(
    await pedir({ servicio: 'ingestion', metodo: 'POST', ruta: 'v1/transaction-imports', formData, raiz: 'transactionImport' }),
  );
}

/** 2) MENSAJE de control `objectImport` en XML: importar un objeto ya subido al bucket privado. */
export async function importarDesdeObjeto(objectKey: string, generation: string): Promise<LoteImportacion> {
  return parseLote(
    await pedir({
      servicio: 'ingestion',
      metodo: 'POST',
      ruta: 'v1/transaction-imports/from-object',
      xml: { raiz: 'objectImport', datos: { objectKey, generation } },
      raiz: 'transactionImport',
    }),
  );
}

export async function listarLotes(page = 1, limit = 20, state?: string) {
  return parseLotes(
    await pedir({
      servicio: 'ingestion',
      ruta: 'v1/transaction-imports',
      params: state ? { state, page, limit } : { page, limit },
      raiz: 'transactionImports',
    }),
  );
}

export async function obtenerLote(id: string): Promise<LoteImportacion> {
  return parseLote(await pedir({ servicio: 'ingestion', ruta: `v1/transaction-imports/${id}`, raiz: 'transactionImport' }));
}

/** Filas con su resultado y error (rechazadas y en conflicto incluidas). */
export async function filasDelLote(id: string, page = 1, limit = 100) {
  return parseFilas(
    await pedir({
      servicio: 'ingestion',
      ruta: `v1/transaction-imports/${id}/rows`,
      params: { page, limit },
      raiz: 'transactionImportRows',
    }),
  );
}

/** Confirmar es idempotente: repetirlo devuelve el resultado guardado o continúa lo pendiente. */
export async function confirmarLote(id: string): Promise<LoteImportacion> {
  return parseLote(
    await pedir({ servicio: 'ingestion', metodo: 'POST', ruta: `v1/transaction-imports/${id}/confirm`, raiz: 'transactionImport' }),
  );
}

/** Solo antes de confirmar. Devuelve el resumen en estado `descartado`. */
export async function descartarLote(id: string): Promise<LoteImportacion> {
  return parseLote(
    await pedir({ servicio: 'ingestion', metodo: 'DELETE', ruta: `v1/transaction-imports/${id}`, raiz: 'transactionImport' }),
  );
}
