import * as ExcelJS from 'exceljs';
import { aFilas, ExcelService } from './excel.service';
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

describe('aFilas', () => {
  it('los números quedan como número, nunca como texto', () => {
    const [fila] = aFilas(reporte([ind({ valor: 142.75 })]));
    expect(fila).toMatchObject({ valor: 142.75, estado: 'Disponible' });
    expect(typeof fila.valor).toBe('number');
  });

  it('un indicador no disponible va con su motivo y SIN valor (nunca 0)', () => {
    const [fila] = aFilas(reporte([ind({ disponible: false, valor: null, motivo: 'algorithms-core no respondió en 3 s.' })]));
    expect(fila).toMatchObject({ valor: null, estado: 'No disponible', nota: 'algorithms-core no respondió en 3 s.' });
  });

  it('una lista vacía o un valor nulo es "Sin datos", distinto de no disponible', () => {
    const filas = aFilas(reporte([ind({ valor: [] }), ind({ valor: null })]));
    expect(filas.map((f) => f.estado)).toEqual(['Sin datos', 'Sin datos']);
  });

  it('una lista de objetos da una fila por elemento y un objeto da una fila por campo, con los números numéricos', () => {
    const filas = aFilas(reporte([
      ind({ nombre: 'Categorías', valor: [{ categoria: 'Lácteos', gasto: 1520.5 }, { categoria: 'Abarrotes', gasto: 900 }] }),
      ind({ nombre: 'Variación', valor: { cambiosAnalizados: 12, variacionPromedioPct: 3.4, variacionMaximaPct: null } }),
    ]));
    expect(filas.slice(0, 2).map((f) => f.valor)).toEqual(['categoria: Lácteos · gasto: 1520.5', 'categoria: Abarrotes · gasto: 900']);
    const cambios = filas.find((f) => f.indicador === 'Variación · cambiosAnalizados')!;
    expect(cambios.valor).toBe(12);
    expect(filas.find((f) => f.indicador === 'Variación · variacionMaximaPct')).toMatchObject({ valor: null, estado: 'Sin datos' });
  });
});

describe('ExcelService', () => {
  const leer = async (buffer: Buffer) => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return libro;
  };

  it('genera un libro válido con una hoja de parámetros y otra de indicadores, con acentos, ñ y celdas numéricas', async () => {
    const buffer = await new ExcelService().generar(reporte([
      ind({ nombre: 'Ticket promedio (MXN por canasta)', valor: 86.4 }),
      ind({ nombre: 'Canastas construidas', valor: 100 }),
      ind({ nombre: 'Galleta ñandú', valor: [{ categoria: 'Lácteos', participacion: '23.75%' }] }),
      ind({ nombre: 'Elasticidad promedio', servicio: 'algorithms-core', disponible: false, valor: null, motivo: 'algorithms-core no respondió en 3 s.' }),
    ]));

    expect(buffer.subarray(0, 2).toString()).toBe('PK'); // un .xlsx es un zip
    const libro = await leer(buffer);
    expect(libro.worksheets.map((h) => h.name)).toEqual(['Reporte', 'Indicadores']);
    expect(libro.getWorksheet('Reporte')!.getCell('B2').value).toBe('2026-08-01 a 2026-08-31');

    const h = libro.getWorksheet('Indicadores')!;
    expect(h.getRow(1).values).toEqual([undefined, 'Servicio', 'Indicador', 'Valor', 'Estado', 'Nota']);
    expect(h.getCell('C2').value).toBe(86.4);
    expect(typeof h.getCell('C2').value).toBe('number');
    expect(h.getCell('C3').value).toBe(100);
    expect(h.getCell('B4').value).toBe('Galleta ñandú');
    expect(h.getCell('C4').value).toContain('23.75%');
    expect(h.getCell('D5').value).toBe('No disponible');
    expect(h.getCell('C5').value).toBeNull(); // sin valor, no un 0
    expect(h.getCell('E5').value).toContain('no respondió');
  });

  it('un reporte sin indicadores igual produce un libro válido (nunca 500)', async () => {
    const libro = await leer(await new ExcelService().generar(reporte([])));
    expect(libro.getWorksheet('Indicadores')!.rowCount).toBe(1); // solo el encabezado
  });
});
