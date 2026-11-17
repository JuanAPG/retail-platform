import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { conCorrelacion } from '../correlation/correlacion';

/** Más que esto y el servicio consultado cuenta como caído (contrato: 3 s → 503). */
const LIMITE_MS = 3000;

export interface RespuestaExterna<T> {
  status: number;
  cuerpo: T | null;
}

/**
 * Llamadas a otros microservicios (catalog, core-process). Los servicios se
 * consultan por HTTP, nunca leyendo sus tablas. Cada llamada reenvía el
 * `Authorization` de quien pidió la operación y su `X-Correlation-Id`.
 *
 * Si el otro servicio no responde a tiempo, la red falla o contesta 5xx, se
 * lanza 503 `SERVICE_UNAVAILABLE` (D-25): no es un error de este servicio.
 * Los 4xx se devuelven a quien llama para que decida (p. ej. 404 de zona).
 */
@Injectable()
export class ServiciosExternos {
  async obtener<T>(servicio: string, url: string, token: string | undefined): Promise<RespuestaExterna<T>> {
    const controller = new AbortController();
    const limite = setTimeout(() => controller.abort(), LIMITE_MS);
    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        headers: conCorrelacion({ Accept: 'application/json', ...(token ? { Authorization: token } : {}) }),
        signal: controller.signal,
      });
    } catch {
      throw new ServiceUnavailableException(`${servicio} no respondió en ${LIMITE_MS / 1000} s.`);
    } finally {
      clearTimeout(limite);
    }
    if (respuesta.status >= 500) {
      throw new ServiceUnavailableException(`${servicio} respondió con error ${respuesta.status}.`);
    }
    const texto = await respuesta.text();
    let cuerpo: T | null = null;
    if (texto) {
      try {
        cuerpo = JSON.parse(texto) as T;
      } catch {
        throw new ServiceUnavailableException(`${servicio} respondió algo que no es JSON.`);
      }
    }
    return { status: respuesta.status, cuerpo };
  }

  /** Recorre todas las páginas de un listado estándar `{ data, total, page, limit }`. */
  async todasLasPaginas<T>(servicio: string, urlBase: string, token: string | undefined): Promise<T[]> {
    const filas: T[] = [];
    const separador = urlBase.includes('?') ? '&' : '?';
    for (let pagina = 1; pagina <= 1000; pagina += 1) {
      const { status, cuerpo } = await this.obtener<{ data: T[]; total: number }>(
        servicio,
        `${urlBase}${separador}page=${pagina}&limit=100`,
        token,
      );
      if (status !== 200 || !cuerpo || !Array.isArray(cuerpo.data)) {
        throw new ServiceUnavailableException(`${servicio} no devolvió el listado (estado ${status}).`);
      }
      filas.push(...cuerpo.data);
      if (cuerpo.data.length === 0 || filas.length >= cuerpo.total) break;
    }
    return filas;
  }
}
