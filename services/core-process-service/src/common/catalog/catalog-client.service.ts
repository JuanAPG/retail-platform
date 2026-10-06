import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export interface TiendaCatalogo {
  id: string;
  nombre: string;
}

export interface PresentacionCatalogo {
  id: string;
  nombre: string;
}

export interface ProductoCatalogo {
  id: string;
  sku: string;
  estatus: string;
  presentaciones: PresentacionCatalogo[];
}

/**
 * Cliente HTTP a catalog-service. Valida la existencia de tiendas,
 * productos y presentaciones contra el catálogo real (no contra copias
 * locales): este servicio no es dueño de esos datos.
 *
 * Degradación: si catalog-service no responde, lanza 503 y NO se inserta
 * nada. Insertar sin validar rompería la integridad con el catálogo.
 */
@Injectable()
export class CatalogClient {
  private readonly logger = new Logger(CatalogClient.name);
  private readonly base =
    process.env.CATALOG_SERVICE_URL ?? 'http://localhost:3102';
  private readonly timeoutMs = 3000;

  async listarTiendas(token?: string): Promise<TiendaCatalogo[]> {
    const cuerpo = await this.get<{ data: TiendaCatalogo[]; total: number } | TiendaCatalogo[]>(
      '/v1/stores',
      token,
      { limit: 100 },
    );
    return Array.isArray(cuerpo) ? cuerpo : (cuerpo.data ?? []);
  }

  async listarProductos(token?: string): Promise<ProductoCatalogo[]> {
    const productos: ProductoCatalogo[] = [];
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    for (;;) {
      const cuerpo = await this.get<{ data: ProductoCatalogo[]; total: number } | ProductoCatalogo[]>(
        '/v1/products',
        token,
        { limit: 100, page },
      );
      const datos = Array.isArray(cuerpo) ? cuerpo : (cuerpo.data ?? []);
      total = Array.isArray(cuerpo) ? datos.length : (cuerpo.total ?? 0);
      productos.push(...datos);
      if (productos.length >= total || datos.length === 0) break;
      page++;
    }
    return productos;
  }

  private async get<T>(ruta: string, token: string | undefined, params: Record<string, number>): Promise<T> {
    const url = new URL(ruta, this.base);
    for (const [clave, valor] of Object.entries(params)) {
      url.searchParams.set(clave, String(valor));
    }
    let respuesta: Response;
    try {
      const controller = new AbortController();
      const limite = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        respuesta = await fetch(url, {
          headers: token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {},
          signal: controller.signal,
        });
      } finally {
        clearTimeout(limite);
      }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Catálogo no disponible (${ruta}): ${motivo}`);
      throw new ServiceUnavailableException('Catálogo no disponible.');
    }
    if (!respuesta.ok) {
      this.logger.warn(`Catálogo respondió ${respuesta.status} en ${ruta}.`);
      throw new ServiceUnavailableException('Catálogo no disponible.');
    }
    return (await respuesta.json()) as T;
  }
}
