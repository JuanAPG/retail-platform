import { Storage } from '@google-cloud/storage';
import { AlmacenNoDisponibleError, AlmacenObjetos, conTope, motivoSeguro, ObjetoGuardado, OpcionesFirma, UrlFirmada } from './almacen';

const TOPE_MS = parseInt(process.env.GCS_TIMEOUT_MS ?? '10000', 10);

/**
 * Google Cloud Storage. El bucket es PRIVADO (uniform bucket-level access, sin
 * `allUsers`); la única forma de leer un objeto es una URL firmada V4 de vida
 * corta que emite este servicio después de autorizar.
 *
 * Identidad: en Cloud Run/GKE se usan las credenciales del servicio (ADC). Para
 * firmar sin llave JSON la cuenta necesita `roles/iam.serviceAccountTokenCreator`
 * sobre sí misma (la librería firma con `signBlob`). Permisos mínimos sobre el
 * bucket: `roles/storage.objectCreator` + `roles/storage.objectViewer`.
 */
export class GcsAlmacen implements AlmacenObjetos {
  readonly tipo = 'gcs' as const;
  private readonly storage: Storage;

  constructor(readonly bucket: string, storage?: Storage) {
    this.storage = storage ?? new Storage(process.env.GCS_PROJECT_ID ? { projectId: process.env.GCS_PROJECT_ID } : {});
  }

  async guardar(ruta: string, contenido: Buffer, tipoContenido: string, metadatos: Record<string, string>): Promise<ObjetoGuardado> {
    const archivo = this.storage.bucket(this.bucket).file(ruta);
    try {
      // `ifGenerationMatch: 0`: nunca se sobrescribe un objeto existente; un reintento usa ruta nueva.
      await conTope(
        archivo.save(contenido, {
          resumable: false,
          contentType: tipoContenido,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: tipoContenido, cacheControl: 'private, no-store', metadata: metadatos },
        }),
        TOPE_MS,
        'GCS save',
      );
      const [meta] = await conTope(archivo.getMetadata(), TOPE_MS, 'GCS metadata');
      return { tamanoBytes: Number(meta.size), generacion: meta.generation != null ? String(meta.generation) : null };
    } catch (error) {
      throw error instanceof AlmacenNoDisponibleError ? error : new AlmacenNoDisponibleError(`GCS: ${motivoSeguro(error)}`);
    }
  }

  async tamano(ruta: string): Promise<number | null> {
    try {
      const [meta] = await conTope(this.storage.bucket(this.bucket).file(ruta).getMetadata(), TOPE_MS, 'GCS metadata');
      return Number(meta.size);
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error instanceof AlmacenNoDisponibleError ? error : new AlmacenNoDisponibleError(`GCS: ${motivoSeguro(error)}`);
    }
  }

  async firmarLectura(ruta: string, op: OpcionesFirma): Promise<UrlFirmada> {
    const expiraEn = new Date(Date.now() + op.ttlSegundos * 1000);
    try {
      const [url] = await conTope(
        this.storage.bucket(this.bucket).file(ruta).getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: expiraEn,
          responseDisposition: `attachment; filename="${op.nombreDescarga}"`,
          responseType: op.tipoContenido,
        }),
        TOPE_MS,
        'GCS firma',
      );
      return { url, expiraEn };
    } catch (error) {
      throw error instanceof AlmacenNoDisponibleError ? error : new AlmacenNoDisponibleError(`GCS: ${motivoSeguro(error)}`);
    }
  }

  async verificar(): Promise<string> {
    try {
      // Solo metadatos del bucket: no lista objetos ni lee contenido.
      await conTope(this.storage.bucket(this.bucket).getMetadata(), 2000, 'GCS bucket');
      return 'ok';
    } catch (error) {
      return `error: ${motivoSeguro(error)}`;
    }
  }
}
