/**
 * Ayudas para leer el XML de los servicios ya convertido a objeto JS.
 *
 * Las rarezas que resuelven (vienen del XmlInterceptor del backend y del
 * parser, no de nuestro código):
 *  - Todo arreglo llega como <data><item>..</item><item>..</item></data>.
 *  - Con UN solo elemento el parser entrega un objeto, no una lista.
 *  - Una lista vacía llega como <data/> y el parser la entrega como ''.
 *  - Un null llega como elemento vacío y el parser lo entrega como ''.
 */

/** Convierte lo que haya (undefined, '', objeto suelto o lista) en una lista de verdad. */
export function asList<T = any>(node: unknown): T[] {
  if (node === undefined || node === null || node === '') return [];
  return Array.isArray(node) ? (node as T[]) : [node as T];
}

/** '' (null en XML) y undefined pasan a null; lo demás se devuelve igual. */
export function nullIfEmpty<T>(value: T | '' | undefined | null): T | null {
  return value === '' || value === undefined || value === null ? null : value;
}

/** Texto seguro: null/'' pasan a ''. Evita que un nombre numérico rompa el tipo. */
export function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

/** Booleano tolerante: el parser puede entregar true o 'true'. */
export function bool(value: unknown): boolean {
  return value === true || value === 'true';
}

/** La respuesta XML viene envuelta en <response>; si no, se usa tal cual (JSON). */
export function unwrap(data: any): any {
  return data?.response ?? data;
}
