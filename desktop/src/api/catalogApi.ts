import { pedir } from './httpClient';
import {
  Municipality,
  Producto,
  Tienda,
  Zone,
  ZoneComparison,
  parseComparison,
  parseMunicipalities,
  parseProductPage,
  parseStorePage,
  parseZonePage,
} from './catalogParsers';

/*
 * catalog-service (3102). Contrato: docs/contratos/catalog-service.md, XSD catalog-service.xsd
 * (namespace catalog/v1). Solo lecturas desde el escritorio.
 */

/** Trae TODAS las zonas (el servicio pagina; máximo 100 por página). */
export async function listZones(): Promise<Zone[]> {
  const all: Zone[] = [];
  for (let page = 1; ; page += 1) {
    const parsed = parseZonePage(
      await pedir({ servicio: 'catalog', ruta: 'v1/zones', params: { page, limit: 100 }, raiz: 'zoneListResponse' }),
    );
    all.push(...parsed.zones);
    if (all.length >= parsed.total || parsed.zones.length === 0) return all;
  }
}

export async function listMunicipalities(): Promise<Municipality[]> {
  return parseMunicipalities(await pedir({ servicio: 'catalog', ruta: 'v1/municipalities', raiz: 'municipalityListResponse' }));
}

export async function compareZones(ids: string[]): Promise<ZoneComparison[]> {
  return parseComparison(
    await pedir({ servicio: 'catalog', ruta: 'v1/zones/compare', params: { ids: ids.join(',') }, raiz: 'zoneCompareResponse' }),
  );
}

/** Productos con sus presentaciones (para elegir qué simular o graficar). */
export async function listProducts(): Promise<Producto[]> {
  const all: Producto[] = [];
  for (let page = 1; ; page += 1) {
    const parsed = parseProductPage(
      await pedir({ servicio: 'catalog', ruta: 'v1/products', params: { page, limit: 100 }, raiz: 'productListResponse' }),
    );
    all.push(...parsed.productos);
    if (all.length >= parsed.total || parsed.productos.length === 0) return all;
  }
}

/** Tiendas activas (todas las páginas); con zonaId, solo las de esa zona. */
export async function listStores(zonaId?: string): Promise<Tienda[]> {
  const all: Tienda[] = [];
  for (let page = 1; ; page += 1) {
    const parsed = parseStorePage(
      await pedir({
        servicio: 'catalog',
        ruta: 'v1/stores',
        params: zonaId ? { page, limit: 100, zonaId } : { page, limit: 100 },
        raiz: 'storeListResponse',
      }),
    );
    all.push(...parsed.tiendas);
    if (all.length >= parsed.total || parsed.tiendas.length === 0) return all;
  }
}
