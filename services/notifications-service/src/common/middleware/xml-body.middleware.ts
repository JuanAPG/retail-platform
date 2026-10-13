import { BadRequestException, Injectable, NestMiddleware } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { NextFunction, Request, Response, text } from 'express';

const TIPOS_XML = ['application/xml', 'text/xml'];

/** Tope del cuerpo: una notificación pesa unos cientos de bytes. */
const LIMITE = '100kb';

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  // Todo llega como string: el DTO valida tipos, el XML no los adivina.
  parseTagValue: false,
  trimValues: true,
});

/**
 * Convierte un cuerpo `application/xml` en el mismo objeto que llegaría
 * como JSON, para que el controlador y el `ValidationPipe` no se enteren.
 *
 * - La raíz debe ser la que declara el XSD del endpoint (`raiz`); su
 *   contenido pasa a ser el cuerpo. Cualquier otra raíz → 400.
 * - `DOCTYPE`/`ENTITY` se rechazan: sin entidades externas ni expansión.
 * - XML mal formado → 400 con el error estándar (JSON o XML según `Accept`).
 * - Con otro `Content-Type` no hace nada: el parser JSON de Nest sigue igual.
 */
export function crearMiddlewareCuerpoXml(raiz: string) {
  const leerTexto = text({ type: TIPOS_XML, limit: LIMITE });

  @Injectable()
  class XmlBodyMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction) {
      leerTexto(req, res, (error?: unknown) => {
        if (error) {
          const status = (error as { status?: number }).status;
          return next(
            status === 413
              ? new BadRequestException(`El cuerpo XML excede ${LIMITE}.`)
              : new BadRequestException('No se pudo leer el cuerpo XML.'),
          );
        }
        if (typeof req.body !== 'string') return next();

        const xml = req.body;
        try {
          if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
            throw new BadRequestException('El XML no puede declarar DOCTYPE ni ENTITY.');
          }
          const valido = XMLValidator.validate(xml);
          if (valido !== true) {
            throw new BadRequestException(`XML mal formado: ${valido.err.msg.replace(/\.$/, '')}.`);
          }
          const arbol = parser.parse(xml) as Record<string, unknown>;
          const cuerpo = arbol[raiz];
          if (cuerpo === undefined || typeof cuerpo !== 'object' || cuerpo === null) {
            throw new BadRequestException(`La raíz del XML debe ser <${raiz}>.`);
          }
          req.body = cuerpo;
          next();
        } catch (e) {
          next(e);
        }
      });
    }
  }
  return XmlBodyMiddleware;
}
