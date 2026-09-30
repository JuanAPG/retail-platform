import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Interceptor global de logging — NO CAMBIAR su formato.
 * Una línea JSON por operación a stdout:
 * `{ timestamp, level, service, requestId, method, path, statusCode, durationMs, userId? }`.
 * `requestId` viene del header `x-request-id` si el llamante lo manda
 * (así se rastrea móvil → servicio → servicio), o se genera aquí.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      headers: Record<string, string | undefined>;
      user?: { id?: string };
    }>();
    const started = Date.now();
    const requestId = request.headers['x-request-id'] ?? randomUUID();
    request.headers['x-request-id'] = requestId;

    return next.handle().pipe(
      tap({
        next: () => this.log(request, requestId, started, 200),
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
