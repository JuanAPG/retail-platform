import {
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * `activo` es opcional porque el campo lo agregó catalog-service después:
 * si no viene, se asume activo para no romper contra una versión vieja del
 * catálogo. Usar siempre `estaActivo()`, nunca `!activo` (un `undefined`
 * daría "inactivo" por accidente).
 */
export interface TiendaCatalogo {
  id: string;
  nombre: string;
  activo?: boolean;
}

export interface PresentacionCatalogo {
  id: string;
  nombre: string;
  activo?: boolean;
}

/** Una entidad del catálogo sin `activo` explícito cuenta como activa. */
export function estaActivo(entidad: { activo?: boolean }): boolean {
  return entidad.activo !== false;
}

export interface ProductoCatalogo {
  id: string;
  sku: string;
  estatus: string;
  presentaciones: PresentacionCatalogo[];
}

interface Paginado<T> {
  data: T[];
  total: number;
}

/** Tope de `limit` que aplica catalog-service (`LIMITE_MAXIMO`). */
const LIMITE_PAGINA = 100;
/** Corta un bucle de paginación que no avance, por si el otro lado cambia. */
const MAX_PAGINAS = 500;

/**
 * Cliente HTTP a catalog-service. Valida la existencia de tiendas,
 * productos y presentaciones contra el catálogo real (no contra copias
 * locales): este servicio no es dueño de esos datos.
 *
 * Degradación: si catalog-service no responde, lanza 503 y NO se inserta
 * nada. Insertar sin validar rompería la integridad con el catálogo. Un
 * 401/403 del catálogo se propaga como 401/403, no como 503: "catálogo no
 * disponible" ante una sesión caducada manda a buscar una caída que no
 * existe.
 */
@Injectable()
export class CatalogClient {
  private readonly logger = new Logger(CatalogClient.name);
  private readonly base =
    process.env.CATALOG_SERVICE_URL ?? 'http://localhost:3102';
  private readonly timeoutMs = 3000;

  async listarTiendas(token?: string): Promise<TiendaCatalogo[]> {
    // Pagina hasta agotar: con `limit=100` a secas, a partir de la tienda
    // 101 una tienda válida se rechazaba como inexistente.
    return this.listarTodo<TiendaCatalogo>('/v1/stores', token);
  }

  async listarProductos(token?: string): Promise<ProductoCatalogo[]> {
    return this.listarTodo<ProductoCatalogo>('/v1/products', token);
  }

  /** Recorre todas las páginas de un endpoint de lista del catálogo. */
  private async listarTodo<T>(ruta: string, token?: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= MAX_PAGINAS; page++) {
      const cuerpo = await this.get<Paginado<T> | T[]>(ruta, token, {
        limit: LIMITE_PAGINA,
        page,
      });
      // Un catálogo chico declarado como excepción de paginación devuelve
      // el arreglo plano: en ese caso ya está todo en la primera vuelta.
      if (Array.isArray(cuerpo)) return cuerpo;

      const datos = cuerpo.data ?? [];
      items.push(...datos);
      const total = cuerpo.total ?? items.length;
      if (datos.length === 0 || items.length >= total) return items;
    }
    this.logger.warn(`El catálogo no terminó de paginar ${ruta} en ${MAX_PAGINAS} páginas.`);
    return items;
  }

  private async get<T>(
    ruta: string,
    token: string | undefined,
    params: Record<string, number>,
  ): Promise<T> {
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
          headers: {
            // El catálogo negocia JSON/XML: se pide JSON explícitamente.
            Accept: 'application/json',
            ...(token
              ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` }
              : {}),
          },
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
      throw await this.traducirError(respuesta, ruta);
    }

    try {
      return (await respuesta.json()) as T;
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.warn(`El catálogo respondió algo que no es JSON en ${ruta}: ${motivo}`);
      throw new ServiceUnavailableException('Catálogo no disponible.');
    }
  }

  /** Distingue "el catálogo me rechazó" de "el catálogo no responde". */
  private async traducirError(respuesta: Response, ruta: string): Promise<HttpException> {
    const detalle = await respuesta.text().catch(() => '');
    this.logger.warn(
      `Catálogo respondió ${respuesta.status} en ${ruta}: ${detalle.slice(0, 300)}`,
    );
    if (respuesta.status === 401) {
      return new UnauthorizedException('La sesión no es válida para consultar el catálogo.');
    }
    if (respuesta.status === 403) {
      return new ForbiddenException('El rol no tiene permiso para consultar el catálogo.');
    }
    return new ServiceUnavailableException('Catálogo no disponible.');
  }
}
