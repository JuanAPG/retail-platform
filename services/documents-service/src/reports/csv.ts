import type { Indicador } from './schemas/report.schema';
import type { ReporteDto } from './reports.service';

/**
 * T-23 / D-46 — CSV del reporte ejecutivo: UNA fila por indicador (los 16), en el orden del
 * reporte. Un indicador no disponible va con `disponible = no`, el valor VACÍO y su motivo
 * (D-20: nunca 0).
 *
 * Formato (RFC 4180): separador coma, fin de línea CRLF, UTF-8 con BOM (para que Excel abra
 * bien acentos y ñ). Un número va tal cual, con punto decimal. Un valor que es lista u objeto
 * va resumido en texto en la misma celda, para no romper "una fila = un indicador".
 */

export const ENCABEZADOS_CSV = ['clave', 'indicador', 'servicio', 'disponible', 'valor', 'motivo'] as const;

/** BOM de UTF-8: sin él, Excel en Windows lee "Ãº" en lugar de "ú". */
const BOM = '﻿';

/**
 * Escapa una celda. Entre comillas si trae coma, comillas o salto de línea; las comillas se
 * duplican. Un TEXTO que empieza con `=`, `+`, `-`, `@`, tabulador o retorno se antepone con `'`
 * para que la hoja de cálculo no lo ejecute como fórmula (inyección CSV). Los números no se tocan:
 * `-3.5` es un número negativo, no una fórmula.
 */
export function celda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : '';
  let texto = valor;
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Lista u objeto resumidos en una sola celda de texto: `a: 1 · b: 2 | c: 3`. */
export function resumirValor(valor: unknown): string | number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'number') return valor;
  if (typeof valor !== 'object') return String(valor);
  const uno = (x: unknown): string => {
    if (x === null || x === undefined) return '';
    if (typeof x !== 'object') return String(x);
    if (Array.isArray(x)) return x.map(uno).join(', ');
    return Object.entries(x as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${uno(v)}`)
      .join(' · ');
  };
  return Array.isArray(valor) ? valor.map(uno).join(' | ') : uno(valor);
}

export function filaDeIndicador(indicador: Indicador): Array<string | number | null> {
  return [
    indicador.clave,
    indicador.nombre,
    indicador.servicio,
    indicador.disponible ? 'si' : 'no',
    indicador.disponible ? resumirValor(indicador.valor) : null,
    indicador.disponible ? null : (indicador.motivo ?? 'No disponible.'),
  ];
}

export function generarCsv(reporte: ReporteDto): Buffer {
  const lineas = [ENCABEZADOS_CSV.join(','), ...reporte.secciones.map((i) => filaDeIndicador(i).map(celda).join(','))];
  return Buffer.from(BOM + lineas.join('\r\n') + '\r\n', 'utf8');
}
