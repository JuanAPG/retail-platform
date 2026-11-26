import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

/**
 * Id de correlación (T-02) — NO CAMBIAR el nombre de la cabecera.
 *
 * Una operación de punta a punta (móvil → servicio → servicio → bitácora)
 * comparte UN `X-Correlation-Id`: llega en la cabecera o se genera en el
 * primer servicio, se devuelve en la respuesta, va en cada línea de log y
 * se reenvía en cada llamada a otro servicio (`conCorrelacion`). Así
 * audit-service y monitoring-service pueden juntar todo lo que pasó.
 *
 * `x-request-id` sigue igual: identifica UNA petición (un salto); el id de
 * correlación identifica la operación completa.
 */
export const CABECERA_CORRELACION = 'x-correlation-id';

/**
 * Lo que se acepta de afuera: letras, dígitos y `._:-`, hasta 100. Un valor
 * fuera de eso (vacío, enorme, con saltos de línea) se reemplaza por uno
 * nuevo para que nadie inyecte texto en los logs ni en la bitácora.
 */
const VALIDO = /^[A-Za-z0-9._:-]{1,100}$/;

const contexto = new AsyncLocalStorage<string>();

/** El id que trae la petición si es válido; si no, uno nuevo. */
export function idDeCorrelacion(entrante: string | string[] | undefined): string {
  const valor = Array.isArray(entrante) ? entrante[0] : entrante;
  return valor && VALIDO.test(valor) ? valor : randomUUID();
}

/** El id de la operación en curso, o `undefined` fuera de una petición (p. ej. un cron). */
export function correlacionActual(): string | undefined {
  return contexto.getStore();
}

/**
 * Cabeceras para llamar a otro servicio con el mismo id. Uso:
 * `fetch(url, { headers: conCorrelacion({ 'Content-Type': 'application/json' }) })`.
 */
export function conCorrelacion(cabeceras: Record<string, string> = {}): Record<string, string> {
  const id = correlacionActual();
  return id ? { ...cabeceras, [CABECERA_CORRELACION]: id } : cabeceras;
}

/** Corre `fn` dentro del contexto de un id (lo usan el middleware y las pruebas). */
export function conIdDeCorrelacion<T>(id: string, fn: () => T): T {
  return contexto.run(id, fn);
}

interface PeticionMinima {
  headers: Record<string, string | string[] | undefined>;
}
interface RespuestaMinima {
  setHeader(nombre: string, valor: string): unknown;
}

/**
 * Middleware de Express (va con `app.use` en main.ts, ANTES que todo): corre
 * antes que los guards, así un 401 también lleva su id. Deja el id en la
 * cabecera de la petición (la leen el logging y el filtro de errores) y en
 * la respuesta, y abre el contexto para `correlacionActual()`.
 */
export function middlewareCorrelacion(req: PeticionMinima, res: RespuestaMinima, next: () => void): void {
  const id = idDeCorrelacion(req.headers[CABECERA_CORRELACION]);
  req.headers[CABECERA_CORRELACION] = id;
  res.setHeader('X-Correlation-Id', id);
  contexto.run(id, next);
}
