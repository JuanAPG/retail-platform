import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  NestMiddleware,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { NextFunction, Request, Response, text } from 'express';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { Observable } from 'rxjs';

/**
 * Cuerpos XML de entrada (contrato §1): `POST /v1/workflow/assignments`
 * (`asignacionRequest`), `PATCH …/:id/implement` (`implementacionRequest`) y
 * `PATCH …/:id/evaluate` (`evaluacionRequest`). Misma idea que promotion-service
 * y decision-service, partida en dos para que el XML pase por los
 * MISMOS guards y la MISMA validación que el JSON:
 *
 *  1. `LeerCuerpoXmlMiddleware` (antes de los guards, como el parser JSON de
 *     Nest): solo lee el cuerpo `application/xml` / `text/xml` como texto,
 *     con tope de 1 MB → 413.
 *  2. `CuerpoXmlInterceptor` (después de SessionGuard y RolesGuard, antes de
 *     los pipes): revisa el `Content-Type` (415 si no es JSON ni XML), rechaza
 *     DOCTYPE/ENTITY, XML mal formado, raíz o namespace distintos a los del
 *     XSD (400), y convierte el XML al mismo objeto que llegaría en JSON. El
 *     `ValidationPipe` global valida ese objeto contra el DTO de siempre.
 *
 * Así, sin sesión → 401 y con un rol sin permiso → 403 aunque el XML venga
 * mal: el XML no se interpreta para quien no puede usar la ruta.
 * Con `application/json` (o sin `Content-Type`) no se toca nada.
 */

export const TIPOS_XML = ['application/xml', 'text/xml'];

/** Tope del cuerpo XML. Una petición de seguimiento pesa unos cientos de bytes. */
export const LIMITE_CUERPO_XML = '1mb';

/** `targetNamespace` de `docs/contratos/recommendations-workflow-service.xsd`. */
export const NAMESPACE_WORKFLOW = 'workflow/v1';

/** Cómo pasar el XML de una raíz al objeto del DTO (el XML no trae tipos). */
export interface FormaCuerpoXml {
  /** Raíz que declara el XSD para la petición (`asignacionRequest`…). */
  raiz: string;
  /**
   * Elementos `xs:decimal` / `xs:integer`: pasan a número si el texto es un
   * decimal válido. Acepta rutas con punto para elementos anidados
   * (`before.value`).
   */
  numeros?: string[];
  /**
   * Elementos complejos que pueden llegar vacíos (`<scope/>`): el parser los
   * deja como `''` y aquí pasan a `{}`, para que el DTO diga qué falta.
   */
  objetos?: string[];
  /** Elementos de tipo `ListaTexto` (`<x><item>…</item></x>`): pasan a arreglo. */
  listas?: string[];
}

/** Tipo de medio sin parámetros, en minúsculas; `null` si no hay cabecera. */
export function tipoDeContenido(cabecera: string | undefined): string | null {
  const tipo = (cabecera ?? '').split(';')[0].trim().toLowerCase();
  return tipo.length > 0 ? tipo : null;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  // Todo llega como texto: el DTO valida los tipos, el XML no los adivina.
  parseTagValue: false,
  trimValues: true,
  // Nada de entidades: ni internas ni externas (además se rechaza DOCTYPE).
  processEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

/** `xs:decimal` (sin exponente): lo único que se convierte a número. */
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/** Nombre local, prefijo y atributos del primer elemento del documento. */
function etiquetaRaiz(xml: string): { prefijo: string | null; nombre: string; atributos: string } | null {
  const sinPrologo = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const m = /^\s*<(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)(\s[^>]*?)?\/?>/.exec(sinPrologo);
  return m ? { prefijo: m[1] ?? null, nombre: m[2], atributos: m[3] ?? '' } : null;
}

/** Namespace de la raíz: `xmlns` por defecto o el `xmlns:prefijo` que use. */
function namespaceDe(raiz: { prefijo: string | null; atributos: string }): string | null {
  const atributo = raiz.prefijo ? `xmlns:${raiz.prefijo}` : 'xmlns';
  const m = new RegExp(`\\s${atributo.replace(/\./g, '\\.')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(` ${raiz.atributos}`);
  return m ? (m[1] ?? m[2]) : null;
}

/**
 * Convierte el texto XML en el objeto que el controlador recibiría en JSON.
 * Lanza `BadRequestException` (400, `VALIDATION_ERROR`) si el XML no sirve.
 * Lo que sí es XML válido pero no cumple el DTO (un UUID mal escrito, un
 * elemento de más) se deja pasar tal cual: el `ValidationPipe` lo rechaza
 * con el mismo detalle que daría al JSON.
 */
export function cuerpoXmlADto(xml: string, forma: FormaCuerpoXml): Record<string, unknown> {
  if (xml.trim().length === 0) {
    throw new BadRequestException('El cuerpo XML está vacío.');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new BadRequestException('El XML no puede declarar DOCTYPE ni ENTITY.');
  }
  const valido = XMLValidator.validate(xml);
  if (valido !== true) {
    throw new BadRequestException(`XML mal formado: ${valido.err.msg.replace(/\.$/, '')} (línea ${valido.err.line}).`);
  }

  const raiz = etiquetaRaiz(xml);
  if (!raiz || raiz.nombre !== forma.raiz) {
    throw new BadRequestException(
      `La raíz del XML debe ser <${forma.raiz}>${raiz ? `, llegó <${raiz.nombre}>` : ''}.`,
    );
  }
  const ns = namespaceDe(raiz);
  if (ns !== NAMESPACE_WORKFLOW) {
    throw new BadRequestException(
      `<${forma.raiz}> debe estar en el namespace "${NAMESPACE_WORKFLOW}"` +
        (ns === null ? ' (falta xmlns).' : `, llegó "${ns}".`),
    );
  }

  const contenido = (parser.parse(xml) as Record<string, unknown>)[forma.raiz];
  if (contenido === '' || contenido === undefined) return {};
  if (typeof contenido !== 'object' || contenido === null || Array.isArray(contenido)) {
    throw new BadRequestException(`<${forma.raiz}> debe contener elementos, no texto.`);
  }

  const cuerpo: Record<string, unknown> = { ...(contenido as Record<string, unknown>) };
  for (const campo of forma.objetos ?? []) {
    if (cuerpo[campo] === '') cuerpo[campo] = {};
  }
  for (const ruta of forma.numeros ?? []) {
    // `before.value`: se baja por los objetos; si algo no es objeto, se deja como vino.
    const partes = ruta.split('.');
    const hoja = partes.pop() as string;
    let padre: unknown = cuerpo;
    for (const parte of partes) {
      padre = typeof padre === 'object' && padre !== null ? (padre as Record<string, unknown>)[parte] : undefined;
    }
    if (typeof padre !== 'object' || padre === null || Array.isArray(padre)) continue;
    const valor = (padre as Record<string, unknown>)[hoja];
    if (typeof valor === 'string' && DECIMAL.test(valor)) (padre as Record<string, unknown>)[hoja] = Number(valor);
  }
  for (const campo of forma.listas ?? []) {
    const valor = cuerpo[campo];
    if (valor === '') {
      cuerpo[campo] = []; // <presentationIds/>: lista vacía (el DTO decide si alcanza)
    } else if (typeof valor === 'object' && valor !== null && !Array.isArray(valor)) {
      const { item, ...otros } = valor as Record<string, unknown>;
      // Solo <item>: cualquier otro hijo deja el valor como vino y el DTO lo rechaza.
      if (Object.keys(otros).length === 0 && item !== undefined) {
        cuerpo[campo] = Array.isArray(item) ? item : [item];
      }
    }
  }
  return cuerpo;
}

/**
 * Lee el cuerpo XML como texto. Va como middleware de ruta (antes de los
 * guards), igual que el parser JSON de Nest: el tope se aplica mientras se
 * lee el flujo, sin cargar en memoria más de 1 MB.
 */
@Injectable()
export class LeerCuerpoXmlMiddleware implements NestMiddleware {
  private readonly leer = text({ type: TIPOS_XML, limit: LIMITE_CUERPO_XML });

  use(req: Request, res: Response, next: NextFunction) {
    this.leer(req, res, (error?: unknown) => {
      if (!error) return next();
      const status = (error as { status?: number }).status;
      if (status === 413) {
        return next(new PayloadTooLargeException('El cuerpo XML excede el límite de 1 MB.'));
      }
      if (status === 415) {
        // body-parser responde 415 a un `charset` que no sabe decodificar.
        return next(new UnsupportedMediaTypeException('El charset del cuerpo XML no está soportado; usa UTF-8.'));
      }
      return next(new BadRequestException('No se pudo leer el cuerpo XML.'));
    });
  }
}

/**
 * Convierte el cuerpo XML al objeto del DTO. Se aplica por handler con
 * `@UseInterceptors(new CuerpoXmlInterceptor({ raiz: '…' }))`.
 */
export class CuerpoXmlInterceptor implements NestInterceptor {
  constructor(private readonly forma: FormaCuerpoXml) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const tipo = tipoDeContenido(req.headers['content-type']);

    // JSON (o sin cuerpo): exactamente como antes.
    if (tipo === null || tipo === 'application/json') return next.handle();

    if (!TIPOS_XML.includes(tipo)) {
      throw new UnsupportedMediaTypeException(
        `Content-Type "${tipo}" no soportado: usa application/json o application/xml.`,
      );
    }
    // Sin cuerpo, body-parser deja el objeto vacío de siempre en vez de un texto.
    if (typeof req.body !== 'string') {
      throw new BadRequestException('El cuerpo XML está vacío.');
    }
    try {
      req.body = cuerpoXmlADto(req.body, this.forma);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new BadRequestException('No se pudo interpretar el cuerpo XML.');
    }
    return next.handle();
  }
}
