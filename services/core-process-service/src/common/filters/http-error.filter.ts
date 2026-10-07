import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CONTENT_TYPE_XML, quiereXml, serializarXml } from '../interceptors/xml.interceptor';

/**
 * Filtro global de errores — NO CAMBIAR su forma de respuesta.
 * Es el estándar transversal de los 10 microservicios (Fase A):
 * `{ statusCode, message, code, details, path, timestamp }`.
 * `code` solo admite valores de `services/snippets/error-codes.md`.
 *
 * `message` es SIEMPRE un string. El detalle que Nest acumula en los 400
 * del `ValidationPipe` viaja en `details` (arreglo), para que el cliente
 * tipado no tenga que soportar dos formas del mismo campo.
 *
 * Responde en XML si el cliente lo pidió en `Accept`, con el mismo
 * serializador del `XmlInterceptor`: los filtros corren fuera de los
 * interceptores, así que si no se hiciera aquí un error pedido en XML
 * saldría en JSON.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('error');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const esHttp = exception instanceof HttpException;
    const status = esHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = esHttp ? exception.getResponse() : null;
    const bodyObj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;

    const crudo = bodyObj && 'message' in bodyObj ? bodyObj.message : esHttp ? body : null;

    // Nest mete los fallos de ValidationPipe como `{ message: string[] }`:
    // el arreglo pasa a `details` y `message` queda como resumen legible.
    const esLista = Array.isArray(crudo);
    const details = esLista ? (crudo as unknown[]).map(String) : null;
    const message = esLista
      ? 'La petición no pasó la validación.'
      : typeof crudo === 'string' && crudo.length > 0
        ? crudo
        : // Una excepción no-HTTP trae texto interno (driver de BD, ioredis):
          // no se expone al cliente, se registra con su stack más abajo.
          'Error interno del servidor.';

    // Un servicio puede mandar su `code` pasando `{ code: '...' }` en el
    // cuerpo de la excepción; si no, se deriva del status HTTP.
    const code =
      bodyObj && 'code' in bodyObj ? String(bodyObj.code) : codeForStatus(status);

    if (!esHttp || status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Único lugar donde queda el stack: Nest ya no lo imprime porque el
      // filtro consume la excepción.
      this.logger.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          service: process.env.SERVICE_NAME ?? 'unknown-service',
          requestId: request.headers['x-request-id'] ?? null,
          method: request.method,
          path: request.url,
          statusCode: status,
          error: exception instanceof Error ? exception.message : String(exception),
        }),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const cuerpo = {
      statusCode: status,
      message,
      code,
      details,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (quiereXml(request.headers['accept'])) {
      response.status(status).type(CONTENT_TYPE_XML).send(serializarXml(cuerpo));
      return;
    }
    response.status(status).json(cuerpo);
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.PAYLOAD_TOO_LARGE:
    case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL';
  }
}
