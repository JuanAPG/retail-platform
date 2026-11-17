/**
 * Llaves de Redis de los catálogos planos de catalog-service (prefijo `catalog:`,
 * el que reserva `common/auth/redis.client.ts`).
 *
 * Unidades, municipios y códigos postales son de solo lectura (se siembran en
 * `db/data_retail.sql`): NO hay invalidación al escribir; los acota el TTL.
 * Las categorías sí se escriben desde T-21 (`CategoriesService`), y cada escritura
 * borra su llave.
 * Si se cambian a mano en la base, se refrescan al caducar o con
 * `docker exec retail_redis redis-cli del catalog:categories` (o la llave que sea).
 *
 * Lo mutable (zonas, tiendas, productos, segmentos) NO se cachea: cambia con las
 * escrituras del propio servicio y se pagina/filtra, así que invalidarlo costaría más
 * de lo que ahorra.
 */
export const LLAVES_CATALOGO = {
  // Solo las ACTIVAS (T-21). Cada escritura de categorías, y el arranque del servicio, la borran.
  categorias: 'catalog:categories',
  unidades: 'catalog:units',
  municipios: 'catalog:municipalities',
  codigosPostales: 'catalog:postal-codes',
} as const;

/** 1 hora: lo que tarde en verse un cambio manual en la base. */
export const TTL_CATALOGOS_SEGUNDOS = 3600;
