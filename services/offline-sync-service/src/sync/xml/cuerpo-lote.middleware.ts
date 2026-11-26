import { BadRequestException, Injectable, NestMiddleware, PayloadTooLargeException } from '@nestjs/common';
import { json, NextFunction, Request, Response, text } from 'express';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { MAX_CAPTURAS } from '../reglas';
import { ValidadorXsd } from './validador-xsd';

/** Tope del cuerpo (contrato §4.3). */
export const LIMITE_CUERPO = '1mb';

const TIPOS_XML = ['application/xml', 'text/xml'];

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  // Todo llega como texto: los números se convierten DESPUÉS de validar el XSD.
  parseTagValue: false,
  trimValues: true,
  isArray: (_nombre, ruta) => ruta === 'loteSync.captures.item',
});

const leerJson = json({ limit: LIMITE_CUERPO });
const leerXml = text({ type: () => true, limit: LIMITE_CUERPO });

function errorDeLectura(error: unknown, formato: 'JSON' | 'XML'): Error {
  const e = error as { status?: number; type?: string };
  if (e.status === 413 || e.type === 'entity.too.large') {
    return new PayloadTooLargeException('El cuerpo del lote excede 1 MB. Divídelo en lotes más chicos.');
  }
  if (e.type === 'entity.parse.failed') return new BadRequestException(`${formato} mal formado.`);
  return new BadRequestException(`No se pudo leer el cuerpo ${formato}.`);
}

function revisarCantidad(cuerpo: unknown): void {
  const capturas = (cuerpo as { captures?: unknown })?.captures;
  if (Array.isArray(capturas) && capturas.length > MAX_CAPTURAS) {
    throw new PayloadTooLargeException(
      `El lote excede el máximo de ${MAX_CAPTURAS} capturas (trae ${capturas.length}). Divídelo en lotes más chicos.`,
    );
  }
}

/** XML ya validado → el mismo objeto que llegaría en JSON (listas como arreglo, números como número). */
export function loteDesdeXml(arbol: Record<string, unknown>): Record<string, unknown> {
  const raiz = arbol.loteSync as Record<string, unknown>;
  const contenedor = raiz.captures;
  const items =
    typeof contenedor === 'object' && contenedor !== null ? ((contenedor as { item?: unknown[] }).item ?? []) : [];
  const captures = items.map((item) => {
    const c = item as Record<string, unknown>;
    const contenido = typeof c.content === 'object' && c.content !== null ? (c.content as Record<string, string>) : {};
    return {
      ...c,
      content: Object.fromEntries(Object.entries(contenido).map(([k, v]) => [k, Number(v)])),
    };
  });
  return { ...raiz, captures };
}

/**
 * Lee el cuerpo de `POST /v1/sync/batches`:
 *  - `application/json` (móvil) o `application/xml` / `text/xml` (escritorio);
 *    otro `Content-Type` → 400.
 *  - Más de 1 MB o más de 500 capturas → 413 (`VALIDATION_ERROR`).
 *  - XML: sin `DOCTYPE`/`ENTITY`, bien formado, raíz `loteSync` y válido contra
 *    el XSD del contrato → si no, 400 con el detalle. Después se convierte al
 *    mismo objeto del JSON y pasa por las mismas validaciones del DTO.
 *
 * Los errores van a `next()`: los atiende el `HttpErrorFilter` y salen con el
 * cuerpo estándar en JSON o XML según `Accept`.
 */
@Injectable()
export class CuerpoLoteMiddleware implements NestMiddleware {
  constructor(private readonly validador: ValidadorXsd) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const tipo = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (tipo === 'application/json') {
      leerJson(req, res, (error?: unknown) => {
        if (error) return next(errorDeLectura(error, 'JSON'));
        try {
          revisarCantidad(req.body);
          next();
        } catch (e) {
          next(e);
        }
      });
      return;
    }
    if (TIPOS_XML.includes(tipo)) {
      leerXml(req, res, (error?: unknown) => {
        if (error) return next(errorDeLectura(error, 'XML'));
        this.convertirXml(req).then(() => next(), next);
      });
      return;
    }
    next(new BadRequestException('Content-Type debe ser application/json (app móvil) o application/xml (escritorio).'));
  }

  private async convertirXml(req: Request): Promise<void> {
    const xml = typeof req.body === 'string' ? req.body : '';
    if (!xml.trim()) throw new BadRequestException('El cuerpo XML está vacío.');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new BadRequestException('El XML no puede declarar DOCTYPE ni ENTITY.');
    const bienFormado = XMLValidator.validate(xml);
    if (bienFormado !== true) {
      throw new BadRequestException(`XML mal formado: ${bienFormado.err.msg.replace(/\.$/, '')} (línea ${bienFormado.err.line}).`);
    }
    const arbol = parser.parse(xml) as Record<string, unknown>;
    if (typeof arbol.loteSync !== 'object' || arbol.loteSync === null) {
      throw new BadRequestException('La raíz del XML debe ser <loteSync xmlns="sync/v1">.');
    }
    const lote = loteDesdeXml(arbol);
    revisarCantidad(lote);
    const errores = await this.validador.errores(xml);
    if (errores.length) throw new BadRequestException(errores);
    req.body = lote;
  }
}
