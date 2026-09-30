import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Filtro global de errores — NO CAMBIAR su forma de respuesta.
 * Es el estándar transversal de los 10 microservicios (Fase A):
 * `{ statusCode, message, code, details, path, timestamp }`.
 * `code` solo admite valores de `services/snippets/error-codes.md`.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : null;

    // Nest mete los fallos de ValidationPipe como `{ message: string[], ... }`.
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message: unknown }).message
        : exception instanceof Error
          ? exception.message
          : 'Error interno del servidor';

    // Un servicio puede mandar su `code` pasando `{ code: '...' }` en el
    // cuerpo de la excepción; si no, se deriva del status HTTP.
    const code =
      typeof body === 'object' && body !== null && 'code' in body
        ? String((body as { code: unknown }).code)
        : codeForStatus(status);

    response.status(status).json({
      statusCode: status,
      message,
      code,
      details: null,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    default:
      return 'INTERNAL';
  }
}
