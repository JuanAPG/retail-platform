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
 *
 * Listas: todo arreglo se envuelve como `<padre><item>…</item></padre>`
 * (igual que el `_llenar` de la plantilla FastAPI), porque el builder
 * por sí solo repetiría la etiqueta padre (`<data>…</data><data>…</data>`)
 * y eso no valida contra ningún XSD. Arreglo vacío → `<padre/>`.
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
        return this.builder.build({ response: normalizarListas(data ?? null) });
      }),
    );
  }
}

/** Envuelve cada arreglo como `{ item: [...] }`, recursivo. Exportada para probarla. */
export function normalizarListas(datos: unknown): unknown {
  if (Array.isArray(datos)) return { item: datos.map(normalizarListas) };
  if (datos !== null && typeof datos === 'object') {
    return Object.fromEntries(
      Object.entries(datos as Record<string, unknown>).map(([clave, valor]) => [
        clave,
        Array.isArray(valor) ? { item: valor.map(normalizarListas) } : normalizarListas(valor),
      ]),
    );
  }
  return datos;
}
