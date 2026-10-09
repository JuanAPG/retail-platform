import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { XmlRoot, XmlRootOpciones } from '../decorators/xml-root.decorator';
import { serializarXml } from '../interceptors/xml.interceptor';

/**
 * XML de ejemplo para Swagger, generado desde el MISMO ejemplo JSON con la
 * MISMA serialización que el `XmlInterceptor` (`serializarXml`): prólogo,
 * raíz del contrato, namespace del servicio y nulos obligatorios. Así el
 * ejemplo que ve quien consume la API es exactamente lo que el servicio
 * emite con `Accept: application/xml`, sin escribir ni mantener XML a mano.
 */
export function ejemploXml(ejemplo: unknown, raiz?: string, opciones: XmlRootOpciones = {}): string {
  return serializarXml(ejemplo, { raiz, siemprePresentes: opciones.siemprePresentes });
}

/**
 * Documenta una respuesta exitosa con ejemplo en JSON **y** en XML
 * (gate del PR). Preferir `@RespuestaXml`, que además declara la raíz.
 */
export function ApiRespuesta(
  status: number,
  descripcion: string,
  ejemplo: unknown,
  raiz?: string,
  opciones: XmlRootOpciones = {},
) {
  return ApiResponse({
    status,
    description: descripcion,
    content: {
      'application/json': { example: ejemplo },
      'application/xml': { example: ejemploXml(ejemplo, raiz, opciones) },
    },
  });
}

/**
 * `@XmlRoot` (lo que el servicio emite) + `@ApiRespuesta` (lo que documenta
 * Swagger) con los MISMOS datos: la raíz se declara una sola vez y el
 * ejemplo no puede contradecir a la respuesta real.
 * Uso: `@RespuestaXml(200, 'Página de corridas.', pagina([...]), 'runListResponse', { siemprePresentes: [...] })`.
 */
export function RespuestaXml(
  status: number,
  descripcion: string,
  ejemplo: unknown,
  raiz: string,
  opciones: XmlRootOpciones = {},
) {
  return applyDecorators(XmlRoot(raiz, opciones), ApiRespuesta(status, descripcion, ejemplo, raiz, opciones));
}

/** Respuesta sin cuerpo (p. ej. `204 No Content` del DELETE). */
export function ApiSinCuerpo(status: number, descripcion: string) {
  return ApiResponse({ status, description: descripcion });
}

const ERRORES: Record<number, { code: string; message: string; descripcion: string }> = {
  400: { code: 'VALIDATION_ERROR', message: 'Validation failed (uuid is expected)', descripcion: 'Petición inválida.' },
  401: { code: 'UNAUTHORIZED', message: 'Falta el token de sesión (Bearer).', descripcion: 'Sin sesión válida.' },
  403: { code: 'FORBIDDEN', message: 'Forbidden resource', descripcion: 'El rol no tiene permiso sobre esta ruta.' },
  404: { code: 'NOT_FOUND', message: 'El recurso no existe.', descripcion: 'No existe.' },
  409: { code: 'CONFLICT', message: 'Ya existe un registro con esos datos.', descripcion: 'Conflicto con el estado actual.' },
  // Solo en algorithms-core: un cálculo que falla después de leer los datos.
  500: {
    code: 'INTERNAL',
    message: 'No se pudo completar el cálculo; quedó registrado como corrida fallida.',
    descripcion: 'Falla durante el cálculo; la corrida queda registrada como fallida.',
  },
  // Lo emite SessionGuard cuando Redis (sesiones) no responde. El 503 por
  // core-process/catalog/pricing/auth caídos llega con ALG-11 (Fase C).
  503: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'No se pudo verificar la sesión: el servicio de sesiones no responde.',
    descripcion: 'Redis (sesiones) no responde: no se puede verificar la sesión.',
  },
};

/**
 * Documenta los errores estándar `{statusCode, message, code, details, path,
 * timestamp}` de una ruta, en JSON y en XML: con `Accept: application/xml`
 * el filtro de errores responde `<error>` con la misma forma.
 */
export function ApiErrores(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((statusCode) => {
      const { code, message, descripcion } = ERRORES[statusCode];
      const cuerpo = { statusCode, message, code, details: null, path: '/v1/…', timestamp: '2026-10-03T12:00:00.000Z' };
      return ApiResponse({
        status: statusCode,
        description: descripcion,
        content: {
          'application/json': { example: cuerpo },
          'application/xml': { example: ejemploXml(cuerpo, 'error') },
        },
      });
    }),
  );
}

/** Envoltura estándar de las listas paginadas (`paginacion.md`). */
export function pagina<T>(data: T[], total = data.length) {
  return { data, total, page: 1, limit: 20 };
}
