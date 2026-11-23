/**
 * T-22 — variación de precio de UNA presentación entre dos fechas, por tienda y por zona.
 * Funciones puras (sin base de datos) para probarlas con el caso de control del contrato.
 *
 * D-06: nunca se mezclan presentaciones. Todo lo que entra aquí es de la misma presentación,
 * así que promediar sus tiendas dentro de una zona sí es comparar lo mismo con lo mismo.
 */

/** Precio de la presentación en una tienda en cada fecha; `null` = la tienda no tenía precio ese día. */
export interface PrecioEnFechas {
  storeId: string;
  storeName: string;
  zoneId: string;
  zoneName: string;
  priceFrom: number | null;
  priceTo: number | null;
}

/** Variación en una tienda. El orden de los campos es el del XSD. */
export interface StoreVariation {
  storeId: string;
  storeName: string;
  zoneId: string;
  zoneName: string;
  disponible: boolean;
  priceFrom: number | null;
  priceTo: number | null;
  /** `priceTo − priceFrom` en pesos. `null` si no es comparable (nunca 0). */
  change: number | null;
  /** `(priceTo − priceFrom) / priceFrom × 100`. */
  changePercent: number | null;
  motivo: string | null;
}

/** Variación en una zona. El orden de los campos es el del XSD. */
export interface ZoneVariation {
  zoneId: string;
  zoneName: string;
  /** Tiendas de la zona que alguna vez tuvieron precio de esta presentación. */
  stores: number;
  /** Tiendas con precio en LAS DOS fechas: solo ellas entran al promedio. */
  comparableStores: number;
  disponible: boolean;
  averageFrom: number | null;
  averageTo: number | null;
  change: number | null;
  changePercent: number | null;
  motivo: string | null;
}

/** A centavos, para no devolver 2.0000000001. */
export function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cambio porcentual a 2 decimales; `null` si la base es 0 (nunca Infinity ni NaN). */
export function porcentajeDeCambio(desde: number, hasta: number): number | null {
  if (desde === 0) return null;
  return centavos(((hasta - desde) / desde) * 100);
}

export function variacionDeTienda(fila: PrecioEnFechas, dateFrom: string, dateTo: string): StoreVariation {
  const base = { storeId: fila.storeId, storeName: fila.storeName, zoneId: fila.zoneId, zoneName: fila.zoneName };
  if (fila.priceFrom === null || fila.priceTo === null) {
    const faltan = [fila.priceFrom === null ? dateFrom : null, fila.priceTo === null ? dateTo : null].filter(Boolean);
    return {
      ...base,
      disponible: false,
      priceFrom: fila.priceFrom,
      priceTo: fila.priceTo,
      change: null,
      changePercent: null,
      motivo: `La tienda no tenía precio de esta presentación el ${faltan.join(' ni el ')}.`,
    };
  }
  return {
    ...base,
    disponible: true,
    priceFrom: fila.priceFrom,
    priceTo: fila.priceTo,
    change: centavos(fila.priceTo - fila.priceFrom),
    changePercent: porcentajeDeCambio(fila.priceFrom, fila.priceTo),
    motivo: null,
  };
}

/**
 * Una fila por zona. El promedio de cada fecha se toma SOLO de las tiendas que tienen precio en
 * las dos: si se promediaran conjuntos distintos, una tienda cara que abrió entre las dos fechas
 * haría parecer que el precio subió aunque nadie lo haya cambiado.
 */
export function variacionPorZona(tiendas: StoreVariation[]): ZoneVariation[] {
  const zonas = new Map<string, StoreVariation[]>();
  for (const tienda of tiendas) {
    zonas.set(tienda.zoneId, [...(zonas.get(tienda.zoneId) ?? []), tienda]);
  }
  return [...zonas.values()]
    .map((deLaZona) => {
      const comparables = deLaZona.filter((t) => t.disponible);
      const base = {
        zoneId: deLaZona[0].zoneId,
        zoneName: deLaZona[0].zoneName,
        stores: deLaZona.length,
        comparableStores: comparables.length,
      };
      if (comparables.length === 0) {
        return {
          ...base,
          disponible: false,
          averageFrom: null,
          averageTo: null,
          change: null,
          changePercent: null,
          motivo: 'Ninguna tienda de la zona tenía precio de esta presentación en las dos fechas.',
        };
      }
      const promedio = (campo: 'priceFrom' | 'priceTo') =>
        comparables.reduce((suma, t) => suma + (t[campo] as number), 0) / comparables.length;
      const desde = promedio('priceFrom');
      const hasta = promedio('priceTo');
      return {
        ...base,
        disponible: true,
        averageFrom: centavos(desde),
        averageTo: centavos(hasta),
        change: centavos(hasta - desde),
        changePercent: porcentajeDeCambio(desde, hasta),
        motivo: null,
      };
    })
    .sort((a, b) => a.zoneName.localeCompare(b.zoneName, 'es'));
}
