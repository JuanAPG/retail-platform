import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateXML } from 'xmllint-wasm';

/**
 * Copia del XSD del contrato (`docs/contratos/offline-sync-service.xsd`) que
 * viaja con el servicio: la imagen de Docker solo lleva la carpeta del
 * servicio. Una prueba unitaria falla si la copia se desfasa del contrato.
 */
export const RUTA_XSD = join(__dirname, '..', '..', 'contrato', 'offline-sync-service.xsd');

/** Máximo de errores que se devuelven en `details`. */
const MAX_ERRORES = 20;

/**
 * Valida XML contra el XSD con libxml2 compilado a WebAssembly
 * (`xmllint-wasm`): es el mismo motor que `xmllint`, sin binarios nativos.
 */
@Injectable()
export class ValidadorXsd {
  private readonly xsd = readFileSync(RUTA_XSD, 'utf8');

  /** `[]` si valida; si no, los errores legibles (línea y motivo). */
  async errores(xml: string): Promise<string[]> {
    const r = await validateXML({
      xml: [{ fileName: 'lote.xml', contents: xml }],
      schema: [{ fileName: 'offline-sync-service.xsd', contents: this.xsd }],
    });
    if (r.valid) return [];
    const errores = r.errors
      .map((e) => e.rawMessage ?? e.message)
      .filter((m) => /validity error|parser error/.test(m))
      .map((m) => m.replace(/^lote\.xml:(\d+): .*?error : /, 'línea $1: ').trim());
    return (errores.length ? errores : ['El XML no valida contra el XSD del contrato.']).slice(0, MAX_ERRORES);
  }
}
