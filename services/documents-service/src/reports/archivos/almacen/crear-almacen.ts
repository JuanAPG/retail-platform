import { randomBytes } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { AlmacenObjetos } from './almacen';
import { GcsAlmacen } from './gcs.almacen';
import { LocalAlmacen } from './local.almacen';

/**
 * Elige el almacén por `ARCHIVOS_ALMACEN` (`local` por defecto, `gcs` en staging).
 * Con `gcs` sin bucket el servicio NO arranca: un reporte "disponible" en un
 * bucket que no existe sería peor que un error de configuración al inicio.
 */
export function crearAlmacen(env: NodeJS.ProcessEnv = process.env): AlmacenObjetos {
  const tipo = (env.ARCHIVOS_ALMACEN ?? 'local').toLowerCase();
  if (tipo === 'gcs') {
    if (!env.GCS_BUCKET_REPORTES) throw new Error('ARCHIVOS_ALMACEN=gcs requiere GCS_BUCKET_REPORTES.');
    return new GcsAlmacen(env.GCS_BUCKET_REPORTES);
  }
  if (tipo !== 'local') throw new Error(`ARCHIVOS_ALMACEN debe ser "local" o "gcs" (llegó "${tipo}").`);
  const carpeta = env.ARCHIVOS_DIR_LOCAL ?? path.join(os.tmpdir(), 'retail-archivos');
  // Sin secreto propio se usa uno aleatorio por proceso: las URLs locales mueren al reiniciar, que es lo correcto.
  const secreto = env.ARCHIVOS_FIRMA_LOCAL_SECRET || randomBytes(32).toString('hex');
  const base = env.ARCHIVOS_URL_BASE_PUBLICA ?? `http://localhost:${env.PORT ?? '3108'}`;
  return new LocalAlmacen(carpeta, secreto, base);
}
