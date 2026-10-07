import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { serializarXml } from '../interceptors/xml.interceptor';
import { LIMITE_DEFAULT, PAGINA_DEFAULT } from '../dto/pagination.dto';

/**
 * XML de ejemplo para Swagger, generado con el MISMO serializador del
 * `XmlInterceptor`. Así el ejemplo que ve quien consume la API es
 * exactamente lo que el servicio emite con `Accept: application/xml`, sin
 * escribir ni mantener XML a mano.
 */
export function ejemploXml(ejemplo: unknown): string {
  return serializarXml(ejemplo);
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

const ERRORES: Record<
  number,
  { code: string; message: string; descripcion: string; details?: string[] }
> = {
  400: {
    code: 'VALIDATION_ERROR',
    message: 'La petición no pasó la validación.',
    details: ['storeId debe ser un UUID válido.'],
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
    descripcion: 'El rol no tiene permiso sobre esta ruta.',
  },
  404: { code: 'NOT_FOUND', message: 'El recurso no existe.', descripcion: 'No existe.' },
  409: {
    code: 'CONFLICT',
    message: 'Ya existe un registro con esos datos.',
    descripcion: 'Conflicto con el estado actual.',
  },
  413: {
    code: 'VALIDATION_ERROR',
    message: 'El archivo supera el máximo de 5 MB.',
    descripcion: 'CSV demasiado grande.',
  },
  415: {
    code: 'VALIDATION_ERROR',
    message: 'Solo se admite un archivo .csv de texto delimitado.',
    descripcion: 'El archivo no es un CSV.',
  },
  500: {
    code: 'INTERNAL',
    message: 'Error interno del servidor.',
    descripcion: 'Falla no controlada (el detalle interno queda en el log, no en la respuesta).',
  },
  503: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Catálogo no disponible.',
    descripcion: 'catalog-service no responde; no se insertó nada.',
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
          'application/xml': { example: ejemploXml(ejemplo) },
        },
      });
    }),
  );
}

/** Envoltura estándar de las listas paginadas (`paginacion.md`). */
export function pagina<T>(data: T[], total = data.length) {
  return { data, total, page: PAGINA_DEFAULT, limit: LIMITE_DEFAULT };
}
