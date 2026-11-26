import { createHmac, timingSafeEqual } from 'crypto';
import { constants as fsConstants, promises as fs } from 'fs';
import * as path from 'path';
import { AlmacenNoDisponibleError, AlmacenObjetos, motivoSeguro, ObjetoGuardado, OpcionesFirma, UrlFirmada } from './almacen';

/**
 * Doble local del almacén: escribe en disco y firma con HMAC-SHA256 una ruta
 * `/v1/files/local/:archivoId?exp=…&sig=…` que sirve el propio servicio.
 * Se comporta como GCS en lo que importa para las pruebas: no sobrescribe,
 * la URL caduca, una firma alterada no abre nada y "caído" se simula con
 * `ARCHIVOS_LOCAL_CAIDO=true`.
 *
 * NO es para staging ni producción: ahí va `ARCHIVOS_ALMACEN=gcs`.
 */
export class LocalAlmacen implements AlmacenObjetos {
  readonly tipo = 'local' as const;
  /** Nombre lógico: la carpeta física no se publica en el registro. */
  readonly bucket = 'local';

  constructor(
    private readonly carpeta: string,
    private readonly secreto: string,
    private readonly urlBase: string,
  ) {}

  private caido() {
    if (process.env.ARCHIVOS_LOCAL_CAIDO === 'true') throw new AlmacenNoDisponibleError('almacén local marcado como caído (ARCHIVOS_LOCAL_CAIDO)');
  }

  /** Ruta en disco; rechaza `..` para que nadie salga de la carpeta. */
  rutaFisica(ruta: string): string {
    const destino = path.resolve(this.carpeta, ruta);
    if (!destino.startsWith(path.resolve(this.carpeta) + path.sep)) throw new AlmacenNoDisponibleError('ruta fuera del almacén');
    return destino;
  }

  async guardar(ruta: string, contenido: Buffer): Promise<ObjetoGuardado> {
    this.caido();
    const destino = this.rutaFisica(ruta);
    try {
      await fs.mkdir(path.dirname(destino), { recursive: true });
      // `wx`: falla si ya existe (equivalente a ifGenerationMatch: 0 en GCS).
      await fs.writeFile(destino, contenido, { flag: 'wx' });
      const info = await fs.stat(destino);
      return { tamanoBytes: info.size, generacion: String(info.mtimeMs) };
    } catch (error) {
      throw new AlmacenNoDisponibleError(`local: ${motivoSeguro(error)}`);
    }
  }

  async tamano(ruta: string): Promise<number | null> {
    this.caido();
    try {
      return (await fs.stat(this.rutaFisica(ruta))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AlmacenNoDisponibleError(`local: ${motivoSeguro(error)}`);
    }
  }

  async leer(ruta: string): Promise<Buffer> {
    this.caido();
    return fs.readFile(this.rutaFisica(ruta));
  }

  firma(archivoId: string, exp: number): string {
    return createHmac('sha256', this.secreto).update(`${archivoId}.${exp}`).digest('hex');
  }

  /** `true` si la firma es de este servicio y no ha caducado. Comparación en tiempo constante. */
  firmaValida(archivoId: string, exp: number, sig: string, ahora = Date.now()): boolean {
    if (!Number.isFinite(exp) || exp * 1000 < ahora || !/^[0-9a-f]{64}$/.test(sig)) return false;
    return timingSafeEqual(Buffer.from(this.firma(archivoId, exp), 'hex'), Buffer.from(sig, 'hex'));
  }

  async firmarLectura(_ruta: string, op: OpcionesFirma): Promise<UrlFirmada> {
    this.caido();
    const expiraEn = new Date(Date.now() + op.ttlSegundos * 1000);
    const exp = Math.floor(expiraEn.getTime() / 1000);
    const url = `${this.urlBase.replace(/\/$/, '')}/v1/files/local/${encodeURIComponent(op.archivoId)}?exp=${exp}&sig=${this.firma(op.archivoId, exp)}`;
    return { url, expiraEn };
  }

  async verificar(): Promise<string> {
    try {
      this.caido();
      await fs.mkdir(this.carpeta, { recursive: true });
      await fs.access(this.carpeta, fsConstants.W_OK);
      return 'ok';
    } catch (error) {
      return `error: ${motivoSeguro(error)}`;
    }
  }
}
