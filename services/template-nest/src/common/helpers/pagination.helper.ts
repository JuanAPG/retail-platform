import { LIMITE_DEFAULT, LIMITE_MAXIMO, PAGINA_DEFAULT, Pagina } from '../dto/pagination.dto';

/**
 * Subconjunto del QueryBuilder que usa la paginación. Se define aquí para
 * no obligar a todos los servicios a depender de TypeORM (algunos solo
 * usan Mongo/Redis); el `SelectQueryBuilder` la cumple tal cual.
 */
export interface Paginable<T> {
  skip(n: number): this;
  take(n: number): this;
  getManyAndCount(): Promise<[T[], number]>;
}

/**
 * Aplica la paginación estándar a un QueryBuilder — NO CAMBIAR su forma.
 * Ordena el llamador ANTES de pasar el `qb` (típico: recientes primero).
 * `page` fuera de rango devuelve `data: []`, nunca error.
 *
 * Uso:
 * ```ts
 * return paginar(qb.orderBy('e.fecha', 'DESC'), filtros);
 * ```
 */
export async function paginar<T>(
  qb: Paginable<T>,
  filtros: { page?: number; limit?: number },
): Promise<Pagina<T>> {
  const page = filtros.page ?? PAGINA_DEFAULT;
  const limit = Math.min(filtros.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO);
  const [data, total] = await qb
    .skip((page - 1) * limit)
    .take(limit)
    .getManyAndCount();
  return { data, total, page, limit };
}
