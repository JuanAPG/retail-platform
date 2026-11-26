import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { serializarXml } from '../interceptors/xml.interceptor';

/**
 * Documenta una respuesta exitosa con ejemplo en JSON **y** en XML
 * (gate del PR). Uso: `@ApiRespuesta(200, 'Bitácora paginada.', pagina, 'auditListResponse')`.
 */
export function ApiRespuesta(status: number, descripcion: string, ejemplo: unknown, raiz?: string, namespace?: string) {
  return ApiResponse({
    status,
    description: descripcion,
    content: {
      'application/json': { example: ejemplo },
      'application/xml': { example: serializarXml(ejemplo, { raiz, namespace }) },
    },
  });
}

const ERRORES: Record<
  number,
  { code: string; message: string; descripcion: string; details?: string[] }
> = {
  400: {
    code: 'VALIDATION_ERROR',
    message: 'La petición no pasó la validación.',
    details: ['page debe ser mayor a 0.'],
    descripcion: 'Petición inválida (el detalle por campo viene en `details`).',
  },
  401: {
    code: 'UNAUTHORIZED',
    message: 'Falta el token de sesión (Bearer).',
    descripcion: 'Sin sesión válida (token inválido, expirado o sesión cerrada en Redis).',
  },
  403: {
    code: 'FORBIDDEN',
    message: 'Forbidden resource',
    descripcion: 'El rol no tiene permiso sobre esta ruta (solo Administrador accede al monitoreo).',
  },
  404: {
    code: 'NOT_FOUND',
    message: 'El servicio solicitado no existe.',
    descripcion: 'No existe un servicio con ese nombre.',
  },
  503: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Una dependencia necesaria no responde.',
    descripcion: 'No se pudo verificar sesión o consultar el historial.',
  },
  500: {
    code: 'INTERNAL',
    message: 'Error interno del servidor.',
    descripcion: 'Falla no controlada (el detalle interno queda en el log, no en la respuesta).',
  },
};

/**
 * Documenta los errores estándar `{statusCode, message, code, details, path,
 * timestamp}` de una ruta, con ejemplo en JSON **y** en XML: el
 * `HttpErrorFilter` también respeta `Accept`, así que el cliente
 * XML-exclusivo recibe sus errores en XML.
 */
export function ApiErrores(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((statusCode) => {
      const { code, message, descripcion, details } = ERRORES[statusCode];
      const ejemplo = {
        statusCode,
        message,
        code,
        details: details ?? null,
        path: '/v1/…',
        timestamp: '2026-10-03T12:00:00.000Z',
      };
      return ApiResponse({
        status: statusCode,
        description: descripcion,
        content: {
          'application/json': { example: ejemplo },
          'application/xml': { example: serializarXml(ejemplo, { raiz: 'error' }) },
        },
      });
    }),
  );
}
