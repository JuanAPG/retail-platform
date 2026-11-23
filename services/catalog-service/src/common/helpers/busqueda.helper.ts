import { Transform } from 'class-transformer';

/** Largo máximo del texto de búsqueda (T-21). */
export const BUSQUEDA_MAXIMA = 100;

/**
 * Patrón para `ILIKE ... ESCAPE '\'` que busca el texto TAL CUAL, en cualquier
 * parte y sin distinguir mayúsculas. Se escapan `%`, `_` y `\`: sin eso, buscar
 * "100%" o "a_b" los trataría como comodines y traería de más.
 * Devuelve `null` si no hay nada que buscar (texto vacío o solo espacios).
 */
export function patronDeBusqueda(texto: string | undefined): string | null {
  const limpio = texto?.trim();
  if (!limpio) return null;
  return `%${limpio.replace(/[\\%_]/g, '\\$&')}%`;
}

/** `?esCanastaBasica=true` llega como texto: lo convierte a booleano y deja lo demás para que falle la validación. */
export const ABooleano = () =>
  Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value));
