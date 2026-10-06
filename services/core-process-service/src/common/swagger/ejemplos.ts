import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { XMLBuilder } from 'fast-xml-parser';
import { normalizarListas } from '../interceptors/xml.interceptor';

/**
 * XML de ejemplo para Swagger, generado desde el MISMO ejemplo JSON y con la
 * MISMA normalización de listas del `XmlInterceptor`. Así el ejemplo que ve
 * quien consume la API es exactamente lo que el servicio emite con
 * `Accept: application/xml`, sin escribir ni mantener XML a mano.
 */
export function ejemploXml(ejemplo: unknown): string {
  return new XMLBuilder({ format: true }).build({ response: normalizarListas(ejemplo ?? null) });
}

/**
 * Documenta una respuesta exitosa con ejemplo en JSON **y** en XML
 * (gate del PR). Uso: `@ApiRespuesta(200, 'Ticket promedio.', 152.4)`.
 */
export function ApiRespuesta(status: number, descripcion: string, ejemplo: unknown) {
  return ApiResponse({
    status,
    description: descripcion,
    content: {
      'application/json': { example: ejemplo },
      'application/xml': { example: ejemploXml(ejemplo) },
    },
  });
}

const ERRORES: Record<number, { code: string; message: string; descripcion: string }> = {
  400: { code: 'VALIDATION_ERROR', message: 'Validation failed (uuid is expected)', descripcion: 'Petición inválida.' },
  401: { code: 'UNAUTHORIZED', message: 'Falta el token de sesión (Bearer).', descripcion: 'Sin sesión válida.' },
  403: { code: 'FORBIDDEN', message: 'Forbidden resource', descripcion: 'El rol no tiene permiso sobre esta ruta.' },
  404: { code: 'NOT_FOUND', message: 'El recurso no existe.', descripcion: 'No existe.' },
  409: { code: 'CONFLICT', message: 'Ya existe un registro con esos datos.', descripcion: 'Conflicto con el estado actual.' },
  413: { code: 'VALIDATION_ERROR', message: 'El archivo supera el máximo de 5 MB.', descripcion: 'CSV demasiado grande.' },
  500: { code: 'INTERNAL', message: 'Error interno del servidor.', descripcion: 'Falla no controlada.' },
  503: { code: 'INTERNAL', message: 'Catálogo no disponible.', descripcion: 'catalog-service no responde; no se insertó nada.' },
};

/**
 * Documenta los errores estándar `{statusCode, message, code, details, path,
 * timestamp}` de una ruta. Los errores salen siempre en JSON (el
 * `XmlInterceptor` solo serializa respuestas exitosas).
 */
export function ApiErrores(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((statusCode) => {
      const { code, message, descripcion } = ERRORES[statusCode];
      return ApiResponse({
        status: statusCode,
        description: descripcion,
        content: {
          'application/json': {
            example: {
              statusCode,
              message,
              code,
              details: null,
              path: '/v1/…',
              timestamp: '2026-10-03T12:00:00.000Z',
            },
          },
        },
      });
    }),
  );
}

/** Envoltura estándar de las listas paginadas (`paginacion.md`). */
export function pagina<T>(data: T[], total = data.length) {
  return { data, total, page: 1, limit: 20 };
}
