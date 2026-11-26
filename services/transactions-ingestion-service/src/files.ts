import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { HttpException, PayloadTooLargeException, UnprocessableEntityException, UnsupportedMediaTypeException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';

export function positiveLimit(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} debe ser un entero positivo.`);
  return value;
}

export const maxBytes = positiveLimit('INGESTION_MAX_BYTES', 8 * 1024 * 1024);
export const maxRows = positiveLimit('INGESTION_MAX_ROWS', 10000);
export type Format = 'csv' | 'json' | 'xml';
export type RawRow = Record<string, unknown> | null;
const fields = ['folio', 'fecha', 'tienda', 'sku', 'presentacion', 'cantidad', 'precio'];
const xml = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, parseTagValue: false, processEntities: false,
  isArray: (name, path) => name === 'item' && path === 'salesFile.rows.item' });
const mimes: Record<Format, string[]> = {
  csv: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  json: ['application/json', 'text/json'],
  xml: ['application/xml', 'text/xml'],
};

export function xmlDocument(text: string, root: string): unknown {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new UnprocessableEntityException('DTD y entidades declaradas están prohibidas.');
  const xsd = process.env.INGESTION_XSD ?? join(__dirname, '../../../docs/contratos/transactions-ingestion-service.xsd');
  try {
    execFileSync('xmllint', ['--nonet', '--noout', '--schema', xsd, '-'], { input: text, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    return xml.parse(text)[root];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('xmllint no está instalado.');
    throw new UnprocessableEntityException('El XML debe cumplir el XSD de ingesta.');
  }
}

export function readFile(buffer: Buffer, mime?: string): { format: Format; rows: RawRow[] } {
  if (buffer.length > maxBytes) throw new PayloadTooLargeException('El archivo excede el límite de bytes.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).trim();
  } catch {
    throw new UnprocessableEntityException('El archivo debe estar codificado en UTF-8.');
  }
  const format: Format = text.startsWith('<') ? 'xml' : /^[{\[]/.test(text) ? 'json' : 'csv';
  const contentType = mime?.split(';')[0].trim().toLowerCase();
  if (contentType && contentType !== 'application/octet-stream' && !mimes[format].includes(contentType)) {
    throw new UnsupportedMediaTypeException('El contenido no coincide con el tipo declarado.');
  }
  let rows: unknown;
  try {
    if (format === 'json') rows = JSON.parse(text)?.rows;
    else if (format === 'xml') rows = (xmlDocument(text, 'salesFile') as { rows?: { item?: unknown } } | undefined)?.rows?.item;
    else {
      rows = parse(text, {
        delimiter: text.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',',
        columns: (header: string[]) => {
          const names = header.map((name) => name.trim().toLowerCase());
          if (!fields.every((field) => names.includes(field)) || new Set(names).size !== names.length) {
            throw new UnprocessableEntityException('El encabezado CSV es inválido.');
          }
          return names;
        },
        trim: true, skip_empty_lines: true, relax_column_count: true,
        on_record: (row, context) => context.error ? nullRow : row,
      }) as unknown[];
    }
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw new UnprocessableEntityException('El archivo tiene una estructura inválida.');
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new UnprocessableEntityException('El archivo debe contener filas.');
  if (rows.length > maxRows) throw new PayloadTooLargeException(`El archivo supera ${maxRows} filas.`);
  return { format, rows: rows.map((row) => row && typeof row === 'object' && !Array.isArray(row) ? row : null) };
}

const nullRow = { malformed: true };
