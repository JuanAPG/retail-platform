/**
 * Adaptador de almacenamiento de objetos privados (contrato:
 * docs/contratos/registro-archivos.md). Lo mismo para reportes (documents) y
 * para lotes de ingesta (transactions-ingestion): cada dominio guarda SU
 * registro de archivo y aplica SUS permisos; el adaptador solo sube, comprueba
 * y firma. Nunca decide quién puede descargar.
 *
 * Dos implementaciones con la misma interfaz:
 * - `gcs`: Google Cloud Storage (`@google-cloud/storage` 7.x). Credenciales por
 *   identidad del servicio en GCP (ADC); en local, `GOOGLE_APPLICATION_CREDENTIALS`.
 * - `local`: doble en disco para desarrollo y pruebas sin bucket. Firma con HMAC
 *   y la descarga la sirve el propio servicio en `/v1/files/local/:archivoId`.
 */
export interface ObjetoGuardado {
  tamanoBytes: number;
  /** Generación/versión del objeto que reporta el almacén, si la da. */
  generacion: string | null;
}

export interface UrlFirmada {
  url: string;
  expiraEn: Date;
}

export interface OpcionesFirma {
  ttlSegundos: number;
  /** Nombre que verá quien descarga (Content-Disposition). NO es la ruta del objeto. */
  nombreDescarga: string;
  tipoContenido: string;
  /** Solo lo usa el doble local para armar su ruta de descarga. */
  archivoId: string;
}

export interface AlmacenObjetos {
  readonly tipo: 'gcs' | 'local';
  /** Bucket (gcs) o carpeta (local). Va al registro del archivo. */
  readonly bucket: string;
  guardar(ruta: string, contenido: Buffer, tipoContenido: string, metadatos: Record<string, string>): Promise<ObjetoGuardado>;
  /** Tamaño del objeto si existe; `null` si no existe. Lanza si el almacén no responde. */
  tamano(ruta: string): Promise<number | null>;
  firmarLectura(ruta: string, opciones: OpcionesFirma): Promise<UrlFirmada>;
  /** `ok` o el motivo del fallo. Nunca lanza. */
  verificar(): Promise<string>;
}

export const ALMACEN_OBJETOS = Symbol('ALMACEN_OBJETOS');

/** Error del almacén (caído, sin permiso, timeout). Se traduce a 503 y deja el archivo `fallido`. */
export class AlmacenNoDisponibleError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'AlmacenNoDisponibleError';
  }
}

/** TTL de las URLs firmadas: 5 min por defecto, tope 15 min (propuesta de política, ver contrato). */
export const TTL_DEFAULT_SEGUNDOS = 300;
export const TTL_MAXIMO_SEGUNDOS = 900;

export function ttlConfigurado(): number {
  const valor = parseInt(process.env.ARCHIVOS_URL_TTL_SEGUNDOS ?? '', 10);
  if (!Number.isFinite(valor) || valor <= 0) return TTL_DEFAULT_SEGUNDOS;
  return Math.min(valor, TTL_MAXIMO_SEGUNDOS);
}

/** Corre `promesa` con un tope de tiempo; al vencer lanza `AlmacenNoDisponibleError`. */
export async function conTope<T>(promesa: Promise<T>, ms: number, que: string): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new AlmacenNoDisponibleError(`${que}: sin respuesta en ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

/** Mensaje de error sin URLs firmadas, tokens ni rutas de credenciales: es lo que va al registro y a los logs. */
export function motivoSeguro(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error);
  return texto
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/(sig|signature|token|X-Goog-[A-Za-z-]+)=[^&\s]+/gi, '$1=***')
    .slice(0, 300);
}
