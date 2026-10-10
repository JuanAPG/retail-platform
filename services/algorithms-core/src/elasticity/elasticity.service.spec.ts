import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FuenteDatos } from '../fuente-datos/fuente-datos.service';
import {
  aggregateBySegment,
  ElasticityService,
  estimateElasticities,
  MAX_STORABLE_ELASTICITY,
  SalesRow,
} from './elasticity.service';

const venta = (presentationId: string, period: string, quantity: number, price: number, zoneId = 'zona-a'): SalesRow => ({
  presentationId,
  zoneId,
  period,
  quantity,
  revenue: quantity * price,
});

const NOMBRES = new Map([
  ['extrema', { product: 'Extremo', presentation: '1 u' }],
  ['normal', { product: 'Normal', presentation: '1 u' }],
]);
const ZONAS = new Map([
  ['zona-a', 'Zona A'],
  ['zona-b', 'Zona B'],
]);
const nacional = (rows: SalesRow[]) => {
  const { results, insufficient } = estimateElasticities(rows, NOMBRES, ZONAS);
  return {
    calculado: results.find((r) => r.zoneId === null),
    insuficiente: insufficient.find((r) => r.zoneId === null),
  };
};

describe('estimateElasticities: agregado nacional', () => {
  it('es una sola regresión sobre las observaciones zona × periodo, sin sumar las zonas de un mismo día', () => {
    // Las dos zonas siguen q = 400 · p^-2 (E = −2). El día 04 solo vende la
    // zona B: sumar las zonas por día sacaría ese punto de la curva.
    const { calculado } = nacional([
      venta('normal', '2026-09-01', 100, 2),
      venta('normal', '2026-09-02', 25, 4),
      venta('normal', '2026-09-03', 16, 5),
      venta('normal', '2026-09-02', 25, 4, 'zona-b'),
      venta('normal', '2026-09-04', 64, 2.5, 'zona-b'),
    ]);

    expect(calculado?.value).toBe(-2);
    expect(calculado?.observations).toBe(5);
    expect(calculado?.rSquared).toBe(1);
  });

  it('se calcula aunque las zonas muevan sus precios en sentido contrario', () => {
    // q = 14 400 · p^-2. Cada día una zona cobra $10 y la otra $12: el
    // promedio por día es siempre el mismo, y sumando las zonas daría
    // "un solo precio".
    const { calculado, insuficiente } = nacional([
      venta('normal', '2026-09-01', 144, 10),
      venta('normal', '2026-09-02', 100, 12),
      venta('normal', '2026-09-03', 144, 10),
      venta('normal', '2026-09-01', 100, 12, 'zona-b'),
      venta('normal', '2026-09-02', 144, 10, 'zona-b'),
      venta('normal', '2026-09-03', 100, 12, 'zona-b'),
    ]);

    expect(insuficiente).toBeUndefined();
    expect(calculado?.value).toBe(-2);
    expect(calculado?.observations).toBe(6);
  });
});

describe('estimateElasticities', () => {
  it('un valor que no cabe en numeric(10,4) va a insufficient y no tumba a las demás presentaciones', () => {
    const rows = [
      // Caso de la revisión del PR #56: 1 u a $10 dos días; el tercero,
      // 999 900 u a $10 más 100 u a $11 → E ≈ 1 381 557.96.
      venta('extrema', '2026-09-01', 1, 10),
      venta('extrema', '2026-09-02', 1, 10),
      { presentationId: 'extrema', zoneId: 'zona-a', period: '2026-09-03', quantity: 1_000_000, revenue: 999_900 * 10 + 100 * 11 },
      // q = 400 · p^-2 → E = −2 exacto.
      venta('normal', '2026-09-01', 100, 2),
      venta('normal', '2026-09-02', 25, 4),
      venta('normal', '2026-09-03', 16, 5),
    ];

    const { results, insufficient } = estimateElasticities(rows, NOMBRES, ZONAS);

    expect(results.map((r) => [r.presentationId, r.zoneId, r.value])).toEqual([
      ['normal', null, -2],
      ['normal', 'zona-a', -2],
    ]);
    expect(insufficient.map((r) => [r.presentationId, r.zoneId])).toEqual([
      ['extrema', null],
      ['extrema', 'zona-a'],
    ]);
    for (const item of insufficient) {
      expect(item.reason).toContain('excede el máximo que se puede guardar');
      expect(item.reason).toContain(String(MAX_STORABLE_ELASTICITY));
    }
  });
});

describe('aggregateBySegment', () => {
  it('marca atypical sobre el promedio del segmento y lo deja en null si no tiene zonas', () => {
    const barras = aggregateBySegment(
      [
        { id: 1, name: 'Bajo' },
        { id: 2, name: 'Alto' },
      ],
      [{ zoneId: 'z1', zoneName: 'Zona 1', value: 3, rSquared: 0.5, observations: 4 }],
      new Map([['z1', 1]]),
    );

    expect(barras.map((b) => [b.label, b.value, b.atypical])).toEqual([
      ['Bajo', 3, true],
      ['Alto', null, null],
    ]);
  });
});

describe('ElasticityService (base simulada)', () => {
  const corrida = {
    id: 'corrida-1',
    periodStart: '2026-08-02',
    periodEnd: '2026-09-20',
    // 19:30 del 8 de octubre en Monterrey: en UTC ya es día 9.
    executedAt: new Date('2026-10-09T01:30:00.000Z'),
    granularity: 'day',
  };

  function servicio(consultas: unknown[][]) {
    const query = jest.fn();
    for (const filas of consultas) query.mockResolvedValueOnce(filas);
    const fuente = {
      nombresDePresentaciones: jest.fn().mockResolvedValue(new Map([['pres-1', { product: 'Queso', presentation: '400 g' }]])),
      zonas: jest.fn().mockResolvedValue([
        { id: 'z-centro', nombre: 'Zona Centro' },
        { id: 'z-oriente', nombre: 'Zona Oriente' },
        { id: 'z-valle', nombre: 'Zona Valle' },
      ]),
    };
    return new ElasticityService({ query } as unknown as DataSource, fuente as unknown as FuenteDatos);
  }

  it('chart con un runId que no tiene la presentación responde 404', async () => {
    const service = servicio([[corrida], []]);

    await expect(service.getComparativeChart({ presentationId: 'pres-1', runId: 'corrida-1' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('chart marca atypical en barras y nacional, y la nota trae la fecha ISO del día local', async () => {
    const service = servicio([
      [corrida],
      [
        { zoneId: 'z-oriente', value: '36.1100', rSquared: '0.41000', observations: 12 },
        { zoneId: 'z-valle', value: '-2.5000', rSquared: '0.90000', observations: 8 },
        { zoneId: null, value: '-1.2000', rSquared: null, observations: 20 },
      ],
    ]);

    const grafico = await service.getComparativeChart({ presentationId: 'pres-1', runId: 'corrida-1' });

    expect(grafico.bars.map((b) => [b.label, b.atypical])).toEqual([
      ['Zona Centro', null],
      ['Zona Oriente', true],
      ['Zona Valle', false],
    ]);
    expect(grafico.national?.atypical).toBe(false);
    expect(grafico.note).toContain('análisis del 2026-10-08');
  });

  it('current marca atypical solo cuando E > 0', async () => {
    const fila = { presentationId: 'pres-1', rSquared: null, observations: 10, runId: 'corrida-1', executedAt: corrida.executedAt };
    const service = servicio([
      [
        { ...fila, zoneId: 'z-oriente', value: '36.1100' },
        { ...fila, zoneId: null, value: '-4.0319' },
      ],
    ]);

    const { data } = await service.current({});

    expect(data.map((e) => [e.zoneName, e.value, e.atypical])).toEqual([
      ['Zona Oriente', 36.11, true],
      ['Nacional', -4.0319, false],
    ]);
  });
});
