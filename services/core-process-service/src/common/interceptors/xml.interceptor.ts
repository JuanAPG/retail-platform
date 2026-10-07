import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { XMLBuilder } from 'fast-xml-parser';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Interceptor global XML — NO CAMBIAR su criterio.
 * Si el cliente pide XML en `Accept`, la misma respuesta del controlador
 * se serializa a XML (`<response>...</response>`, UTF-8, con prólogo).
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
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    if (!quiereXml(request.headers['accept'])) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse<{ setHeader: (k: string, v: string) => void }>();
        response.setHeader('Content-Type', CONTENT_TYPE_XML);
        return serializarXml(data);
      }),
    );
  }
}

export const CONTENT_TYPE_XML = 'application/xml; charset=utf-8';

const PROLOGO = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * Serializa a XML con el prólogo y la raíz `<response>` del estándar.
 * Compartida con `HttpErrorFilter` para que un error pedido en XML salga
 * en XML con la misma forma que una respuesta exitosa.
 */
export function serializarXml(datos: unknown): string {
  const cuerpo = new XMLBuilder({ format: true }).build({ response: normalizarListas(datos ?? null) });
  return `${PROLOGO}\n${cuerpo}`;
}

/**
 * Negociación de `Accept` — NO CAMBIAR su criterio.
 * Acepta `application/xml`, `text/xml` y cualquier `*+xml`, respetando los
 * q-values: si el cliente prefiere JSON, se le da JSON. `*​/*` y la
 * ausencia del header se resuelven como JSON (el default del estándar).
 */
export function quiereXml(accept: string | undefined): boolean {
  const tipos = parsearAccept(accept);
  const qXml = Math.max(0, ...tipos.filter((t) => esXml(t.tipo)).map((t) => t.q));
  const qJson = Math.max(0, ...tipos.filter((t) => t.tipo === 'application/json').map((t) => t.q));
  return qXml > 0 && qXml >= qJson;
}

function esXml(tipo: string): boolean {
  return tipo === 'application/xml' || tipo === 'text/xml' || tipo.endsWith('+xml');
}

function parsearAccept(accept: string | undefined): { tipo: string; q: number }[] {
  return (accept ?? '')
    .split(',')
    .map((parte) => {
      const [tipo, ...parametros] = parte.trim().split(';');
      const qParam = parametros.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      return { tipo: tipo.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((t) => t.tipo.length > 0);
}

/**
 * Envuelve cada arreglo como `{ item: [...] }`, recursivo. Exportada para
 * probarla.
 *
 * Las fechas se emiten como ISO 8601: un `Date` es `typeof 'object'`, y
 * recorrerlo con `Object.entries` da `[]`, así que sin este caso el
 * builder cerraría la etiqueta vacía y la fecha se perdería (el cliente de
 * escritorio es XML-exclusivo y filtra por periodo).
 */
export function normalizarListas(datos: unknown): unknown {
  if (Array.isArray(datos)) return { item: datos.map(normalizarListas) };
  if (datos instanceof Date) return datos.toISOString();
  if (datos !== null && typeof datos === 'object') {
    return Object.fromEntries(
      Object.entries(datos as Record<string, unknown>).map(([clave, valor]) => [
        clave,
        // `undefined` desaparecería de la salida y rompería un xs:sequence
        // con elementos obligatorios: se emite como elemento vacío.
        valor === undefined ? null : normalizarListas(valor),
      ]),
    );
  }
  return datos;
}
