import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { XMLBuilder } from 'fast-xml-parser';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Interceptor global XML — NO CAMBIAR su criterio.
 * Si el cliente manda `Accept: application/xml`, la misma respuesta del
 * controlador se serializa a XML (`<response>...</response>`, UTF-8).
 * Con cualquier otro `Accept`, la respuesta sale en JSON sin tocarla.
 * El XSD de cada endpoint vive en `docs/contratos/` (Fase A).
 */
@Injectable()
export class XmlInterceptor implements NestInterceptor {
  private readonly builder = new XMLBuilder({ format: true });

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const wantsXml = (request.headers['accept'] ?? '').includes('application/xml');

    return next.handle().pipe(
      map((data) => {
        if (!wantsXml) return data;
        const response = context.switchToHttp().getResponse<{ setHeader: (k: string, v: string) => void }>();
        response.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return this.builder.build({ response: data ?? null });
      }),
    );
  }
}
