import { formatearValor, PdfService } from './pdf.service';
import { Indicador } from './schemas/report.schema';
import type { ReporteDto } from './reports.service';

const indicador = (extra: Partial<Indicador>): Indicador => ({
  clave: 'k', nombre: 'Galleta ñandú', servicio: 'core-process-service', disponible: true, valor: 1, motivo: null, ...extra,
});

describe('formatearValor', () => {
  it('un indicador no disponible dice por qué y NUNCA se imprime como cero', () => {
    const texto = formatearValor(indicador({ disponible: false, valor: null, motivo: 'algorithms-core no respondió en 3 s.' }));
    expect(texto).toBe('No disponible — algorithms-core no respondió en 3 s.');
    expect(texto).not.toMatch(/^0/);
  });

  it('números enteros, decimales a 2 posiciones, y vacío como "sin datos"', () => {
    expect(formatearValor(indicador({ valor: 100 }))).toBe('100');
    expect(formatearValor(indicador({ valor: 86.4 }))).toBe('86.40');
    expect(formatearValor(indicador({ valor: [] }))).toBe('Sin datos para el periodo');
    expect(formatearValor(indicador({ valor: null }))).toBe('Sin datos para el periodo');
  });

  it('listas de objetos salen una línea por elemento', () => {
    const texto = formatearValor(indicador({ valor: [{ categoria: 'Lácteos', gasto: 1520.5 }, { categoria: 'Abarrotes', gasto: 900 }] }));
    expect(texto.split('\n')).toEqual(['• categoria: Lácteos · gasto: 1520.5', '• categoria: Abarrotes · gasto: 900']);
  });
});

describe('PdfService', () => {
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

  it('genera un PDF válido con acentos, ñ, $ y %, sin lanzar', async () => {
    const buffer = await new PdfService().generar(reporte([indicador({ valor: [{ producto: 'Galleta ñandú', gasto: '$1,520.50', participacion: '23.75%' }] })]));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(800);
  });

  it('un reporte sin ningún indicador disponible igual produce un PDF (nunca 500)', async () => {
    const buffer = await new PdfService().generar(reporte([indicador({ disponible: false, valor: null, motivo: 'caído' })]));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('un reporte vacío produce un PDF', async () => {
    expect((await new PdfService().generar(reporte([]))).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
