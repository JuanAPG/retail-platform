import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { XMLBuilder } from 'fast-xml-parser';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { XML_ROOT_KEY, XmlRootOpciones } from '../decorators/xml-root.decorator';

/**
 * Interceptor global XML — NO CAMBIAR su criterio.
 *
 * Si el cliente pide XML en `Accept`, la misma respuesta del controlador se
 * serializa a XML. Con cualquier otro `Accept`, la respuesta sale en JSON
 * sin tocarla.
 *
 * El XML tiene que validar contra el XSD del endpoint
 * (`docs/contratos/*.xsd`), porque la app de escritorio es XML-exclusiva y
 * valida con XSD. Eso impone cuatro cosas:
 *
 *  1. **Raíz con nombre.** Los XSD declaran raíces como `zoneListResponse`
 *     o `indiceAccesibilidad`, no `response`. El nombre lo declara cada
 *     handler con `@XmlRoot('…')`; sin decorador se conserva `<response>`
 *     para no romper los endpoints que todavía no lo declaran.
 *  2. **Namespace.** Los XSD usan `targetNamespace` con
 *     `elementFormDefault="qualified"`, así que la raíz lleva el `xmlns`
 *     por defecto del servicio (`XML_NAMESPACE`) y con eso los hijos
 *     quedan calificados sin prefijo.
 *  3. **Declaración XML** al inicio del documento.
 *  4. **Fechas y nulos.** `Date` → ISO 8601 UTC (un `Date` es
 *     `typeof 'object'` y recorrerlo con `Object.entries` da `[]`, así que
 *     sin tratarlo aparte la etiqueta salía vacía y la fecha se perdía).
 *     Los nulos se OMITEN, porque los XSD declaran los campos opcionales
 *     con `minOccurs="0"` y un elemento vacío no es un `xs:decimal` ni un
 *     `xs:dateTime` válido; los campos que su XSD exige presentes aunque
 *     sean nulos se declaran en `@XmlRoot(..., { siemprePresentes })`.
 *
 * Listas: todo arreglo se envuelve como `<padre><item>…</item></padre>`
 * (igual que el middleware de la plantilla FastAPI), porque el builder por
 * sí solo repetiría la etiqueta padre y eso no valida contra ningún XSD.
 */
@Injectable()
export class XmlInterceptor implements NestInterceptor {
  constructor(private readonly reflector?: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    if (!quiereXml(request.headers['accept'])) {
      return next.handle();
    }

    // El decorador del handler gana sobre el de la clase.
    const meta = this.reflector?.getAllAndOverride<{ elemento: string } & XmlRootOpciones>(
      XML_ROOT_KEY,
      [context.getHandler(), context.getClass()],
    );

    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse<{ setHeader: (k: string, v: string) => void }>();
        response.setHeader('Content-Type', CONTENT_TYPE_XML);
        return serializarXml(data, {
          raiz: meta?.elemento,
          siemprePresentes: meta?.siemprePresentes,
        });
      }),
    );
  }
}

export const CONTENT_TYPE_XML = 'application/xml; charset=utf-8';

const PROLOGO = '<?xml version="1.0" encoding="UTF-8"?>';

/** Raíz por defecto: la conservan los endpoints que no declaran `@XmlRoot`. */
export const RAIZ_POR_DEFECTO = 'response';

/**
 * Namespace del servicio, el mismo `targetNamespace` de su XSD
 * (`catalog/v1`, `pricing/v1`, `algorithms/v1`, `decision/v1`…).
 * Se inyecta por entorno para que la plantilla sirva igual a los 10.
 * Vacío = sin `xmlns`, que es lo que corresponde a un endpoint sin XSD.
 */
export function namespaceXml(): string {
  return process.env.XML_NAMESPACE ?? '';
}

export interface OpcionesSerializacion {
  /** Nombre del elemento raíz; por defecto `response`. */
  raiz?: string;
  /** Elementos que se emiten aunque su valor sea nulo (ver `@XmlRoot`). */
  siemprePresentes?: string[];
  /** Namespace a poner como `xmlns` en la raíz; por defecto el del servicio. */
  namespace?: string;
}

/**
 * Serializa a XML con el prólogo, la raíz y el namespace del contrato.
 * Compartida con `HttpErrorFilter`, para que un error pedido en XML salga
 * en XML con la misma forma que una respuesta exitosa.
 */
export function serializarXml(datos: unknown, opciones: OpcionesSerializacion = {}): string {
  const raiz = opciones.raiz ?? RAIZ_POR_DEFECTO;
  const ns = opciones.namespace ?? namespaceXml();
  const cuerpo = normalizar(datos ?? null, new Set(opciones.siemprePresentes ?? []));

  // El `xmlns` va como atributo de la raíz: con `elementFormDefault`
  // "qualified" eso califica a todos los hijos sin necesidad de prefijo.
  const contenido =
    cuerpo !== null && typeof cuerpo === 'object' && !Array.isArray(cuerpo)
      ? { ...(ns ? { '@_xmlns': ns } : {}), ...(cuerpo as Record<string, unknown>) }
      : ns
        ? { '@_xmlns': ns, '#text': cuerpo }
        : cuerpo;

  const xml = new XMLBuilder({ format: true, ignoreAttributes: false, attributeNamePrefix: '@_' }).build(
    { [raiz]: contenido },
  );
  return `${PROLOGO}\n${xml}`;
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
 * Prepara el objeto para el builder: envuelve arreglos como `item`, pasa
 * las fechas a ISO y quita los nulos (salvo los declarados en
 * `siemprePresentes`, que se emiten vacíos). Exportada para probarla.
 */
export function normalizar(datos: unknown, siemprePresentes: Set<string> = new Set()): unknown {
  if (Array.isArray(datos)) {
    return { item: datos.map((d) => normalizar(d, siemprePresentes)) };
  }
  if (datos instanceof Date) return datos.toISOString();
  if (datos !== null && typeof datos === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [clave, valor] of Object.entries(datos as Record<string, unknown>)) {
      if (valor === null || valor === undefined) {
        // Un nulo se omite para no violar el tipo del XSD; si el esquema
        // lo exige presente (uniones `*OrEmpty`), sale como elemento vacío.
        if (siemprePresentes.has(clave)) salida[clave] = '';
        continue;
      }
      salida[clave] = normalizar(valor, siemprePresentes);
    }
    return salida;
  }
  return datos;
}

/**
 * Compatibilidad: el nombre anterior de `normalizar`. Se conserva porque
 * los servicios la importaban para sus pruebas.
 * @deprecated usa `normalizar`.
 */
export const normalizarListas = (datos: unknown): unknown => normalizar(datos);
