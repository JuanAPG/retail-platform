import { BadRequestException } from '@nestjs/common';

/**
 * M06 — Parser CSV mínimo sin dependencias.
 *
 * Formato esperado (una línea = una línea de venta; las filas con el
 * mismo folio + tienda + fecha se agrupan en una transacción):
 *
 *   folio,fecha,tienda,sku,presentacion,cantidad,precio
 *
 * - Delimitador `,` o `;` (se detecta del encabezado).
 * - Campos entrecomillados con `""` de escape.
 * - Encabezado obligatorio, en cualquier orden, insensible a
 *   mayúsculas y espacios.
 */
export interface CsvTabla {
  encabezados: string[];
  /** Filas de datos (sin encabezado); cada celda ya sin comillas externas. */
  filas: string[][];
}

const COLUMNAS_REQUERIDAS = [
  'folio',
  'fecha',
  'tienda',
  'sku',
  'presentacion',
  'cantidad',
  'precio',
] as const;

export type ColumnaCsv = (typeof COLUMNAS_REQUERIDAS)[number];

/** Posición de cada columna requerida dentro de la fila. */
export type MapaColumnas = Record<ColumnaCsv, number>;

function partirLinea(linea: string, delimitador: string): string[] {
  const celdas: string[] = [];
  let actual = '';
  let entreComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (entreComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') {
          actual += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        actual += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === delimitador) {
      celdas.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  celdas.push(actual);
  return celdas.map((c) => c.trim());
}

export function parsearCsv(buffer: Buffer): { tabla: CsvTabla; mapa: MapaColumnas } {
  const texto = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lineas.length < 2) {
    throw new BadRequestException(
      'El archivo no trae datos: se esperaba encabezado + al menos una fila.',
    );
  }

  const encabezado = lineas[0];
  const comas = (encabezado.match(/,/g) ?? []).length;
  const puntosComa = (encabezado.match(/;/g) ?? []).length;
  const delimitador = puntosComa > comas ? ';' : ',';

  const encabezados = partirLinea(encabezado, delimitador).map((h) =>
    h.toLowerCase().replace(/\s+/g, ''),
  );

  const faltantes = COLUMNAS_REQUERIDAS.filter((c) => !encabezados.includes(c));
  if (faltantes.length > 0) {
    throw new BadRequestException(
      `Encabezado incompleto: faltan las columnas ${faltantes.join(', ')}. ` +
        `Se esperaban: ${COLUMNAS_REQUERIDAS.join(', ')}.`,
    );
  }

  const mapa = Object.fromEntries(
    COLUMNAS_REQUERIDAS.map((c) => [c, encabezados.indexOf(c)]),
  ) as MapaColumnas;

  const filas = lineas.slice(1).map((l) => partirLinea(l, delimitador));

  return { tabla: { encabezados, filas }, mapa };
}
