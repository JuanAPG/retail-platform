import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { ReporteDto } from './reports.service';

/** Una fila plana del libro: un indicador, o un renglón de un indicador que es una lista. */
export interface FilaExcel {
  servicio: string;
  indicador: string;
  /** Número (celda numérica) o texto; vacío si no hay dato. */
  valor: number | string | null;
  estado: 'Disponible' | 'No disponible' | 'Sin datos';
  nota: string;
}

/** Aplana los indicadores a filas: los números van como número, nunca como texto (D-19: "cifras como celdas numéricas"). */
export function aFilas(reporte: ReporteDto): FilaExcel[] {
  const filas: FilaExcel[] = [];
  for (const i of reporte.secciones) {
    if (!i.disponible) {
      filas.push({ servicio: i.servicio, indicador: i.nombre, valor: null, estado: 'No disponible', nota: i.motivo ?? '' });
      continue;
    }
    const v = i.valor;
    if (typeof v === 'number') {
      filas.push({ servicio: i.servicio, indicador: i.nombre, valor: v, estado: 'Disponible', nota: '' });
    } else if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) {
      filas.push({ servicio: i.servicio, indicador: i.nombre, valor: null, estado: 'Sin datos', nota: 'Sin datos para el periodo' });
    } else if (Array.isArray(v)) {
      for (const x of v) filas.push({ servicio: i.servicio, indicador: i.nombre, valor: resumen(x), estado: 'Disponible', nota: '' });
    } else if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        filas.push({
          servicio: i.servicio,
          indicador: `${i.nombre} · ${k}`,
          valor: typeof val === 'number' ? val : val === null || val === undefined ? null : resumen(val),
          estado: val === null || val === undefined ? 'Sin datos' : 'Disponible',
          nota: '',
        });
      }
    } else {
      filas.push({ servicio: i.servicio, indicador: i.nombre, valor: String(v), estado: 'Disponible', nota: '' });
    }
  }
  return filas;
}

function resumen(x: unknown): string {
  if (x === null || typeof x !== 'object') return String(x);
  return Object.entries(x as Record<string, unknown>)
    .filter(([, val]) => val !== null && val !== undefined)
    .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(', ') : typeof val === 'object' ? JSON.stringify(val) : String(val)}`)
    .join(' · ');
}

/** Exportación a Excel del reporte guardado (D-19, opcional): una hoja de parámetros y una de indicadores. */
@Injectable()
export class ExcelService {
  async generar(reporte: ReporteDto): Promise<Buffer> {
    const libro = new ExcelJS.Workbook();
    libro.creator = 'Plataforma minorista';
    libro.created = reporte.creadoEn;

    const p = libro.addWorksheet('Reporte');
    p.columns = [{ width: 24 }, { width: 48 }];
    p.addRow(['Reporte ejecutivo']).font = { bold: true, size: 14 };
    p.addRow(['Periodo', `${reporte.parametros.dateFrom} a ${reporte.parametros.dateTo}`]);
    if (reporte.parametros.zoneId) p.addRow(['Zona', reporte.parametros.zoneId]);
    if (reporte.parametros.segmentId) p.addRow(['Segmento', reporte.parametros.segmentId]);
    p.addRow(['Generado', reporte.creadoEn.toISOString()]);
    p.addRow(['Reporte', reporte.id]);
    p.addRow([]);
    p.addRow(['Los indicadores "No disponible" corresponden a servicios que no respondieron al generar el reporte; no equivalen a cero.']).font = { italic: true };

    const h = libro.addWorksheet('Indicadores');
    h.columns = [
      { header: 'Servicio', key: 'servicio', width: 24 },
      { header: 'Indicador', key: 'indicador', width: 52 },
      { header: 'Valor', key: 'valor', width: 36 },
      { header: 'Estado', key: 'estado', width: 16 },
      { header: 'Nota', key: 'nota', width: 48 },
    ];
    h.getRow(1).font = { bold: true };
    h.views = [{ state: 'frozen', ySplit: 1 }];
    for (const fila of aFilas(reporte)) {
      const r = h.addRow(fila);
      if (typeof fila.valor === 'number') r.getCell('valor').numFmt = Number.isInteger(fila.valor) ? '#,##0' : '#,##0.00';
      if (fila.estado === 'No disponible') r.getCell('estado').font = { color: { argb: 'FFA33A3A' } };
    }
    return Buffer.from(await libro.xlsx.writeBuffer());
  }
}
