import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { Indicador } from './schemas/report.schema';
import type { ReporteDto } from './reports.service';

/** Texto corto y legible de un valor de indicador (número, lista u objeto). */
export function formatearValor(i: Indicador): string {
  if (!i.disponible) return `No disponible — ${i.motivo ?? 'sin motivo'}`;
  const v = i.valor;
  if (v === null || v === undefined) return 'Sin datos para el periodo';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v.length === 0 ? 'Sin datos para el periodo' : v.map((x) => linea(x)).join('\n');
  }
  return linea(v);
}

function linea(x: unknown): string {
  if (x === null || typeof x !== 'object') return `• ${String(x)}`;
  const partes = Object.entries(x as Record<string, unknown>)
    .filter(([, val]) => val !== null && val !== undefined)
    .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(', ') : typeof val === 'object' ? JSON.stringify(val) : String(val)}`);
  return `• ${partes.join(' · ')}`;
}

/**
 * PDF del reporte ejecutivo (DOC-02, D-19: obligatorio; Excel puede quedar para después).
 * Usa la fuente estándar Helvetica de PDF, que cubre Latin-1: á é í ó ú ñ ü $ %
 * se ven bien sin incrustar fuentes.
 */
@Injectable()
export class PdfService {
  generar(reporte: ReporteDto): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: 'Reporte ejecutivo', Author: 'Plataforma minorista' } });
      const trozos: Buffer[] = [];
      doc.on('data', (t: Buffer) => trozos.push(t));
      doc.on('end', () => resolve(Buffer.concat(trozos)));
      doc.on('error', reject);

      const p = reporte.parametros;
      doc.font('Helvetica-Bold').fontSize(20).text('Reporte ejecutivo');
      doc.moveDown(0.3).font('Helvetica').fontSize(10).fillColor('#555555');
      doc.text(`Periodo: ${p.dateFrom} a ${p.dateTo}`);
      if (p.zoneId) doc.text(`Zona: ${p.zoneId}`);
      if (p.segmentId) doc.text(`Segmento: ${p.segmentId}`);
      doc.text(`Generado: ${reporte.creadoEn.toISOString()} · Reporte ${reporte.id}`);
      doc.fillColor('#000000').moveDown();

      if (reporte.secciones.every((s) => !s.disponible)) {
        doc.fontSize(11).text('Ningún indicador estuvo disponible al generar el reporte.');
      }
      const servicios = [...new Set(reporte.secciones.map((s) => s.servicio))];
      for (const servicio of servicios) {
        doc.moveDown(0.5).font('Helvetica-Bold').fontSize(13).fillColor('#1a4d7a').text(servicio);
        doc.fillColor('#000000');
        for (const i of reporte.secciones.filter((s) => s.servicio === servicio)) {
          doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10.5).text(i.nombre);
          doc.font('Helvetica').fontSize(10).fillColor(i.disponible ? '#000000' : '#a33a3a').text(formatearValor(i));
          doc.fillColor('#000000');
        }
      }

      doc.moveDown().font('Helvetica-Oblique').fontSize(8).fillColor('#777777')
        .text('Los indicadores marcados como "No disponible" corresponden a servicios que no respondieron al generar el reporte; no equivalen a cero.');
      doc.end();
    });
  }
}
