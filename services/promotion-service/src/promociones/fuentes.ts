import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { conCorrelacion } from '../common/correlation/correlacion';

/** Contrato §6 y §11: catalog y pricing sin respuesta en 3 s → 503. */
export const LIMITE_FUENTES_MS = 3000;

type Servicio = 'catalog-service' | 'pricing-service';

/** Lo que se usa del objeto Presentation de catalog (`contenido` y `factorBase` son cadenas decimales). */
export interface PresentacionCatalogo {
  id: string;
  productoId: string;
  nombre: string;
  contenido: string;
  activo: boolean;
  unidadMedida: { clave: string; tipo: string; factorBase: string };
}

export interface ProductoCatalogo {
  id: string;
  nombre: string;
  estatus: string;
  presentaciones: PresentacionCatalogo[];
}

export interface TiendaCatalogo {
  id: string;
  activo: boolean;
  zonaId: string;
}

export interface ZonaCatalogo {
  id: string;
  activo: boolean;
}

export interface UnidadCatalogo {
  clave: string;
  tipo: string;
  factorBase: string;
}

/** El precio actual que da pricing (`price` es cadena decimal). */
export interface PrecioVigente {
  price: number;
  effectiveDate: string;
}

/** Variables de entorno de las dos fuentes; sin ellas el servicio no arranca. */
export function urlsDeFuentes(entorno: NodeJS.ProcessEnv = process.env): { catalog: string; pricing: string } {
  const faltan = ['CATALOG_SERVICE_URL', 'PRICING_SERVICE_URL'].filter((v) => !entorno[v]?.trim());
  if (faltan.length) {
    throw new Error(`promotion-service necesita ${faltan.join(' y ')} (lee catálogo y precios por HTTP, contrato §6 y §11).`);
  }
  return { catalog: (entorno.CATALOG_SERVICE_URL as string).trim(), pricing: (entorno.PRICING_SERVICE_URL as string).trim() };
}

/**
 * Lecturas por HTTP a catalog-service y pricing-service (contrato §6, §11):
 * reenvían el `Authorization` del usuario y el `X-Correlation-Id`, timeout
 * de 3 s. Sin respuesta, error de red, 5xx o una respuesta que no se
 * entiende → 503. Nunca escribe nada en esos servicios (D-39).
 */
@Injectable()
export class Fuentes {
  private readonly logger = new Logger('fuentes');
  private readonly urls = urlsDeFuentes();

  /** `null` si el producto no existe (404). */
  async producto(id: string, token: string): Promise<ProductoCatalogo | null> {
    return this.unoONulo<ProductoCatalogo>('catalog-service', `v1/products/${id}`, token);
  }

  async tienda(id: string, token: string): Promise<TiendaCatalogo | null> {
    return this.unoONulo<TiendaCatalogo>('catalog-service', `v1/stores/${id}`, token);
  }

  async zona(id: string, token: string): Promise<ZonaCatalogo | null> {
    return this.unoONulo<ZonaCatalogo>('catalog-service', `v1/zones/${id}`, token);
  }

  async unidades(token: string): Promise<UnidadCatalogo[]> {
    const { status, cuerpo } = await this.get<UnidadCatalogo[]>('catalog-service', 'v1/units', token);
    if (status !== 200 || !Array.isArray(cuerpo)) throw this.inesperada('catalog-service', status);
    return cuerpo;
  }

  /**
   * Precio regular vigente HOY (D-05) de la presentación en la tienda:
   * `GET /v1/prices/current?presentationId=&storeId=`. `null` si no tiene.
   */
  async precioVigente(presentationId: string, storeId: string, token: string): Promise<PrecioVigente | null> {
    const ruta = `v1/prices/current?presentationId=${presentationId}&storeId=${storeId}`;
    const { status, cuerpo } = await this.get<{ data: Array<{ price: string; effectiveDate: string }> }>('pricing-service', ruta, token);
    if (status !== 200 || !cuerpo || !Array.isArray(cuerpo.data)) throw this.inesperada('pricing-service', status);
    const fila = cuerpo.data[0];
    if (!fila) return null;
    const price = Number(fila.price);
    if (!Number.isFinite(price) || price <= 0) throw this.inesperada('pricing-service', status);
    return { price, effectiveDate: fila.effectiveDate };
  }

  private async unoONulo<T>(servicio: Servicio, ruta: string, token: string): Promise<T | null> {
    const { status, cuerpo } = await this.get<T>(servicio, ruta, token);
    if (status === 404) return null;
    if (status !== 200 || !cuerpo) throw this.inesperada(servicio, status);
    return cuerpo;
  }

  private async get<T>(servicio: Servicio, ruta: string, token: string): Promise<{ status: number; cuerpo: T | null }> {
    const base = servicio === 'catalog-service' ? this.urls.catalog : this.urls.pricing;
    const url = new URL(ruta, base.endsWith('/') ? base : `${base}/`).toString();
    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        headers: conCorrelacion({ Accept: 'application/json', Authorization: token }),
        signal: AbortSignal.timeout(LIMITE_FUENTES_MS),
      });
    } catch (error) {
      const nombre = (error as { name?: string })?.name;
      throw new ServiceUnavailableException(
        nombre === 'TimeoutError' ? `${servicio} no respondió en 3 s.` : `${servicio} no responde.`,
      );
    }
    if (respuesta.status >= 500) throw new ServiceUnavailableException(`${servicio} respondió con error ${respuesta.status}.`);
    const texto = await respuesta.text().catch(() => '');
    try {
      return { status: respuesta.status, cuerpo: texto ? (JSON.parse(texto) as T) : null };
    } catch {
      throw new ServiceUnavailableException(`${servicio} respondió algo que no es JSON.`);
    }
  }

  private inesperada(servicio: Servicio, status: number): ServiceUnavailableException {
    this.logger.warn(JSON.stringify({ evento: 'fuente_inesperada', servicio, status }));
    return new ServiceUnavailableException(`${servicio} respondió de forma inesperada (${status}).`);
  }
}
