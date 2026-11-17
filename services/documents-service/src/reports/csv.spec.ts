import { celda, ENCABEZADOS_CSV, generarCsv, resumirValor } from './csv';
import { Indicador } from './schemas/report.schema';
import type { ReporteDto } from './reports.service';

const ind = (extra: Partial<Indicador>): Indicador => ({
  clave: 'k', nombre: 'Indicador', servicio: 'core-process-service', disponible: true, valor: 1, motivo: null, ...extra,
});

const reporte = (secciones: Indicador[]): ReporteDto => ({
  id: '6705f1c2a3b4c5d6e7f80912',
  tipo: 'ejecutivo',
  parametros: { dateFrom: '2026-08-01', dateTo: '2026-08-31', zoneId: null, segmentId: null },
  formato: 'json',
  usuarioId: 'u1',
  estado: 'generado',
  creadoEn: new Date('2026-10-08T18:00:00Z'),
  secciones,
});

/** Texto del CSV sin el BOM, partido en líneas. */
const lineas = (buffer: Buffer) => buffer.toString('utf8').replace(/^﻿/, '').split('\r\n');

describe('CSV del reporte ejecutivo (T-23, D-46)', () => {
  it('lleva BOM de UTF-8, encabezado y fin de línea CRLF', () => {
    const buffer = generarCsv(reporte([ind({ clave: 'ticket_promedio', valor: 86.4 })]));
    expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const texto = buffer.toString('utf8');
    expect(texto.endsWith('\r\n')).toBe(true);
    expect(lineas(buffer)[0]).toBe(ENCABEZADOS_CSV.join(','));
  });

  it('una fila por indicador: los 16 del reporte, en su orden', () => {
    const secciones = Array.from({ length: 16 }, (_, n) => ind({ clave: `ind_${n + 1}`, valor: n }));
    const filas = lineas(generarCsv(reporte(secciones))).filter(Boolean);
    expect(filas).toHaveLength(17);
    expect(filas.slice(1).map((f) => f.split(',')[0])).toEqual(secciones.map((s) => s.clave));
  });

  it('un indicador NO disponible va con su motivo y el valor vacío, nunca 0 (D-20)', () => {
    const [, fila] = lineas(
      generarCsv(reporte([ind({ clave: 'elasticidad_promedio', nombre: 'Elasticidad promedio', servicio: 'algorithms-core', disponible: false, valor: null, motivo: 'algorithms-core no respondió en 3 s.' })])),
    );
    expect(fila).toBe('elasticidad_promedio,Elasticidad promedio,algorithms-core,no,,algorithms-core no respondió en 3 s.');
  });

  it('un no disponible sin motivo guardado también lo explica', () => {
    const [, fila] = lineas(generarCsv(reporte([ind({ disponible: false, valor: null, motivo: null })])));
    expect(fila.endsWith(',no,,No disponible.')).toBe(true);
  });

  it('los números van tal cual, con punto decimal; un disponible sin datos va vacío', () => {
    const filas = lineas(generarCsv(reporte([ind({ valor: 1520.5 }), ind({ valor: -0.82 }), ind({ valor: null })])));
    expect(filas[1].split(',')[4]).toBe('1520.5');
    expect(filas[2].split(',')[4]).toBe('-0.82');
    expect(filas[3]).toBe('k,Indicador,core-process-service,si,,');
  });

  it('una lista u objeto se resume en UNA celda (entre comillas si trae coma)', () => {
    expect(resumirValor([{ categoria: 'Lácteos', gasto: 1520.5 }, { categoria: 'Abarrotes', gasto: 900 }])).toBe(
      'categoria: Lácteos · gasto: 1520.5 | categoria: Abarrotes · gasto: 900',
    );
    expect(resumirValor({ antecedente: ['pan', 'leche'], soporte: 0.3 })).toBe('antecedente: pan, leche · soporte: 0.3');
    const [, fila] = lineas(generarCsv(reporte([ind({ valor: { antecedente: ['pan', 'leche'] } })])));
    expect(fila).toBe('k,Indicador,core-process-service,si,"antecedente: pan, leche",');
  });

  it('escapa comillas, comas y saltos de línea, y conserva acentos, ñ, $ y %', () => {
    expect(celda('Año "ñ" $5, 10%')).toBe('"Año ""ñ"" $5, 10%"');
    expect(celda('dos\nlíneas')).toBe('"dos\nlíneas"');
    expect(celda('Categorías principales')).toBe('Categorías principales');
  });

  it('neutraliza fórmulas en TEXTO (inyección CSV), pero no toca números negativos', () => {
    expect(celda('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(celda('+1')).toBe("'+1");
    expect(celda('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(celda(-3.5)).toBe('-3.5');
  });

  it('un número no finito no se escribe (nunca NaN ni Infinity)', () => {
    expect(celda(Number.NaN)).toBe('');
    expect(celda(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('un reporte sin indicadores da solo el encabezado, nunca un error', () => {
    expect(lineas(generarCsv(reporte([]))).filter(Boolean)).toEqual([ENCABEZADOS_CSV.join(',')]);
  });
});
