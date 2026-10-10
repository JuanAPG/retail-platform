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

const venta = (presentationId: string, period: string, quantity: number, price: number): SalesRow => ({
  presentationId,
  zoneId: 'zona-a',
  period,
  quantity,
  revenue: quantity * price,
});

const NOMBRES = new Map([
  ['extrema', { product: 'Extremo', presentation: '1 u' }],
  ['normal', { product: 'Normal', presentation: '1 u' }],
]);
const ZONAS = new Map([['zona-a', 'Zona A']]);

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
    executedAt: new Date('2026-10-08T21:58:12.402Z'),
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

  it('chart marca atypical en barras y nacional, y la nota trae la fecha ISO', async () => {
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
