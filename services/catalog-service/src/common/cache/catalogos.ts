/**
 * Llaves de Redis de los catálogos planos de catalog-service (prefijo `catalog:`,
 * el que reserva `common/auth/redis.client.ts`).
 *
 * Son catálogos de solo lectura: este servicio no tiene ninguna ruta que los
 * modifique (categorías, unidades, municipios y códigos postales se siembran en
 * `db/data_retail.sql`), así que NO hay invalidación al escribir; los acota el TTL.
 * Si se cambian a mano en la base, se refrescan al caducar o con
 * `docker exec retail_redis redis-cli del catalog:categories` (o la llave que sea).
 *
 * Lo mutable (zonas, tiendas, productos, segmentos) NO se cachea: cambia con las
 * escrituras del propio servicio y se pagina/filtra, así que invalidarlo costaría más
 * de lo que ahorra.
 */
export const LLAVES_CATALOGO = {
  categorias: 'catalog:categories',
  unidades: 'catalog:units',
  municipios: 'catalog:municipalities',
  codigosPostales: 'catalog:postal-codes',
} as const;

/** 1 hora: lo que tarde en verse un cambio manual en la base. */
export const TTL_CATALOGOS_SEGUNDOS = 3600;
