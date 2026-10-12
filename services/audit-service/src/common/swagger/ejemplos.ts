import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { serializarXml } from '../interceptors/xml.interceptor';

/**
 * XML de ejemplo para Swagger, generado con el MISMO serializador del
 * `XmlInterceptor`. Así el ejemplo que ve quien consume la API es
 * exactamente lo que el servicio emite con `Accept: application/xml`, sin
 * escribir ni mantener XML a mano.
 */
export function ejemploXml(ejemplo: unknown, raiz?: string): string {
  return serializarXml(ejemplo, { raiz });
}

/**
 * Documenta una respuesta exitosa con ejemplo en JSON **y** en XML
 * (gate del PR). Uso: `@ApiRespuesta(200, 'Bitácora paginada.', pagina, 'auditListResponse')`.
 */
export function ApiRespuesta(status: number, descripcion: string, ejemplo: unknown, raiz?: string) {
  return ApiResponse({
    status,
    description: descripcion,
    content: {
      'application/json': { example: ejemplo },
      'application/xml': { example: ejemploXml(ejemplo, raiz) },
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
    details: ['servicio no puede tener más de 40 caracteres.'],
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
    descripcion: 'El rol no tiene permiso sobre esta ruta (solo Administrador y Auditor leen la bitácora).',
  },
  404: {
    code: 'NOT_FOUND',
    message: 'El evento no existe.',
    descripcion: 'No existe un evento de bitácora con ese id.',
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
          'application/xml': { example: ejemploXml(ejemplo, 'error') },
        },
      });
    }),
  );
}
