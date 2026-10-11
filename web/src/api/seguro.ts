/**
 * Los datos vienen de otros servicios: una página puede traer `data` ausente,
 * que no sea arreglo o con elementos nulos. Las pantallas reciben siempre un
 * arreglo de objetos, nunca algo que reviente al leer una propiedad.
 */
export function listaSegura<T extends object>(valor: unknown): T[] {
  return Array.isArray(valor) ? (valor.filter((x) => x !== null && typeof x === 'object') as T[]) : [];
}
