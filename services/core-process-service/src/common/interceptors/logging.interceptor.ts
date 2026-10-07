import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Interceptor global de logging — NO CAMBIAR su formato.
 * Una línea JSON por operación a stdout:
 * `{ timestamp, level, service, requestId, method, path, statusCode, durationMs, userId? }`.
 * `requestId` viene del header `x-request-id` si el llamante lo manda
 * (así se rastrea móvil → servicio → servicio), o se genera aquí; se
 * devuelve en la respuesta para que el cliente pueda citarlo.
 *
 * Las peticiones rechazadas por un guard no pasan por aquí (los guards
 * corren antes de los interceptores): esos 401/403 los registra
 * `HttpErrorFilter`, que sí los ve.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{
      method: string;
      url: string;
      headers: Record<string, string | undefined>;
      user?: { id?: string };
    }>();
    const response = http.getResponse<{
      statusCode?: number;
      setHeader?: (k: string, v: string) => void;
    }>();

    const started = Date.now();
    const requestId = request.headers['x-request-id'] ?? randomUUID();
    request.headers['x-request-id'] = requestId;
    response.setHeader?.('x-request-id', requestId);

    return next.handle().pipe(
      tap({
        // El status real lo fija Nest antes de emitir (201 en los POST).
        next: () => this.log(request, requestId, started, response.statusCode ?? 200),
        error: (error: { status?: number }) =>
          this.log(request, requestId, started, error?.status ?? 500),
      }),
    );
  }

  private log(
    request: { method: string; url: string; user?: { id?: string } },
    requestId: string,
    started: number,
    statusCode: number,
  ) {
    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'log',
        service: process.env.SERVICE_NAME ?? 'unknown-service',
        requestId,
        method: request.method,
        path: request.url,
        statusCode,
        durationMs: Date.now() - started,
        ...(request.user?.id ? { userId: request.user.id } : {}),
      }),
    );
  }
}
