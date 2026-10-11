import { AxiosError } from 'axios';

/**
 * Cuerpo de error estándar de los 10 servicios:
 * `{ statusCode, message, code, details, path, timestamp }`. `message` es
 * siempre string; el detalle por campo de los 400 viaja en `details`.
 * (Se acepta además `message` como arreglo por si algún servicio viejo lo manda.)
 */
interface CuerpoError {
  message?: string | string[];
  details?: string[] | null;
  code?: string;
}

export type ClaseError =
  | 'red' // la petición nunca llegó (servicio apagado, CORS, URL mal)
  | 'timeout'
  | 'validacion' // 400
  | 'sesion' // 401
  | 'prohibido' // 403
  | 'no-encontrado' // 404
  | 'conflicto' // 409
  | 'limite' // 429
  | 'no-disponible' // 503 (Redis/Mongo/otro servicio caído)
  | 'servidor' // 5xx
  | 'desconocido';

/** Clasifica un error de axios para decidir qué se muestra y si se puede reintentar. */
export function claseDeError(err: unknown): ClaseError {
  const error = err as AxiosError;
  if (!error?.isAxiosError) return 'desconocido';
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return 'timeout';
  if (!error.response) return 'red';
  switch (error.response.status) {
    case 400:
      return 'validacion';
    case 401:
      return 'sesion';
    case 403:
      return 'prohibido';
    case 404:
      return 'no-encontrado';
    case 409:
      return 'conflicto';
    case 429:
      return 'limite';
    case 503:
      return 'no-disponible';
    default:
      return error.response.status >= 500 ? 'servidor' : 'desconocido';
  }
}

/** Solo estas clases tienen sentido de reintentar: las demás fallarían igual. */
export function esReintentable(err: unknown): boolean {
  return ['red', 'timeout', 'no-disponible', 'servidor', 'limite'].includes(claseDeError(err));
}

export function statusDe(err: unknown): number | null {
  return (err as AxiosError)?.response?.status ?? null;
}

/**
 * Traduce cualquier error de axios al mensaje que se le muestra al usuario.
 * Distingue "la petición nunca llegó" de "el servicio respondió con un error".
 */
export function mensajeDeError(
  err: unknown,
  fallback = 'Ocurrió un error inesperado. Intenta de nuevo.',
): string {
  const error = err as AxiosError<CuerpoError>;
  const clase = claseDeError(err);
  const cuerpo = error?.response?.data;

  const propio = Array.isArray(cuerpo?.message) ? cuerpo?.message.join(' ') : cuerpo?.message;
  const detalle = cuerpo?.details?.length ? ` ${cuerpo.details.join(' ')}` : '';

  // Ruta que el servicio todavía no implementa (Nest: "Cannot GET /v1/..."): no se le enseña eso al usuario.
  if (clase === 'no-encontrado' && /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(propio ?? '')) {
    return 'Esta función aún no está disponible en el servicio. Avisa al equipo.';
  }

  switch (clase) {
    case 'red':
      return 'No se pudo conectar con el sistema. Verifica tu conexión e intenta de nuevo en unos minutos.';
    case 'timeout':
      return 'El servicio tardó demasiado en responder. Intenta de nuevo.';
    case 'validacion':
      return `${propio ?? 'Hay datos que no son válidos.'}${detalle}`.trim();
    case 'sesion':
      return propio ?? 'Tu sesión expiró. Inicia sesión de nuevo.';
    case 'prohibido':
      return propio ?? 'Tu rol no tiene permiso para esta acción.';
    case 'no-encontrado':
      return propio ?? 'No se encontró lo que buscas. Puede que ya no exista.';
    case 'conflicto':
      return propio ?? 'La acción choca con el estado actual del registro. Actualiza e intenta de nuevo.';
    case 'limite':
      return 'Demasiados intentos seguidos. Espera un momento antes de volver a intentar.';
    case 'no-disponible':
      return propio ?? 'El servicio no está disponible por ahora. Intenta de nuevo en unos minutos.';
    case 'servidor':
      return 'El servicio tuvo un error interno. Intenta de nuevo; si persiste, avisa al equipo.';
    default:
      return propio ?? fallback;
  }
}
