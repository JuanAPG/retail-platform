import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ReporteDeCorridas } from '../common/reportes/reporte-de-corridas.service';
import { FuenteDatos } from '../fuente-datos/fuente-datos.service';
import {
  aggregateBySegment,
  ElasticityService,
  estimateElasticities,
  MAX_STORABLE_ELASTICITY,
  SalesRow,
} from './elasticity.service';
import { ReglasElasticidad } from './elasticity.math';

/** Reglas de antes (3 observaciones, 2 precios): estas pruebas verifican el CÁLCULO con casos de QA chicos. */
const REGLAS_QA: ReglasElasticidad = { minObservaciones: 3, minPreciosDistintos: 2 };

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
  const { results, insufficient } = estimateElasticities(rows, NOMBRES, ZONAS, REGLAS_QA);
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
      // 1 u a $1 000.00 dos días; el tercero, 1 000 000 u a $1 000.01 (un centavo más, sí es otro
      // precio) → E ≈ 1.38 millones: no cabe en numeric(10,4).
      venta('extrema', '2026-09-01', 1, 1000),
      venta('extrema', '2026-09-02', 1, 1000),
      venta('extrema', '2026-09-03', 1_000_000, 1000.01),
      // q = 400 · p^-2 → E = −2 exacto.
      venta('normal', '2026-09-01', 100, 2),
      venta('normal', '2026-09-02', 25, 4),
      venta('normal', '2026-09-03', 16, 5),
    ];

    const { results, insufficient } = estimateElasticities(rows, NOMBRES, ZONAS, REGLAS_QA);

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

  it('caso de la revisión del PR #56: un precio promedio de $10.0001 es $10 al centavo → un solo precio', () => {
    // 1 u a $10 dos días; el tercero, 999 900 u a $10 más 100 u a $11. Antes daba E ≈ 1 381 557.96
    // (ruido de la cuarta decimal del promedio); ahora es lo que es: no hubo cambio de precio.
    const { results, insufficient } = estimateElasticities(
      [
        venta('extrema', '2026-09-01', 1, 10),
        venta('extrema', '2026-09-02', 1, 10),
        { presentationId: 'extrema', zoneId: 'zona-a', period: '2026-09-03', quantity: 1_000_000, revenue: 999_900 * 10 + 100 * 11 },
      ],
      NOMBRES,
      ZONAS,
      REGLAS_QA,
    );
    expect(results).toEqual([]);
    expect(insufficient.map((r) => [r.zoneName, r.distinctPrices])).toEqual([['Nacional', 1], ['Zona A', 1]]);
    expect(insufficient[0].reason).toContain('Un solo precio');
  });

  const deZonaA = (rows: SalesRow[]) =>
    estimateElasticities(rows, NOMBRES, ZONAS, REGLAS_QA).results.find((r) => r.zoneId === 'zona-a');

  it('caso A del plan de QA por el camino del cálculo: guarda −2.3624 y R² 0.99997, el redondeo que va a la base', () => {
    // Día 1 con dos ventas (60 + 40 a $10): se suman en una sola observación.
    expect(
      deZonaA([
        venta('normal', '2026-09-01', 60, 10),
        venta('normal', '2026-09-01', 40, 10),
        venta('normal', '2026-09-02', 80, 11),
        venta('normal', '2026-09-03', 65, 12),
      ]),
    ).toMatchObject({ value: -2.3624, classification: 'elastic', rSquared: 0.99997, observations: 3, atypical: false });
  });

  it('caso B de QA: el día 1 (10 u a $10 + 30 u a $12) vale $11.5, no el promedio simple ni la última venta', () => {
    expect(
      deZonaA([
        venta('normal', '2026-09-01', 10, 10),
        venta('normal', '2026-09-01', 30, 12),
        venta('normal', '2026-09-02', 30, 13),
        venta('normal', '2026-09-03', 25, 14),
      ]),
    ).toMatchObject({ value: -2.385, rSquared: 0.99984, observations: 3 });
  });

  it('una E positiva (la demanda sube con el precio) sale atypical en el cálculo', () => {
    // q = 4 · p² → E = +2.
    expect(
      deZonaA([
        venta('normal', '2026-09-01', 16, 2),
        venta('normal', '2026-09-02', 64, 4),
        venta('normal', '2026-09-03', 100, 5),
      ]),
    ).toMatchObject({ value: 2, classification: 'elastic', atypical: true });
  });

  it('cantidad 0 (la base la prohíbe) va a insufficient con su motivo, nunca como NaN', () => {
    const { results, insufficient } = estimateElasticities(
      [venta('normal', '2026-09-01', 100, 2), venta('normal', '2026-09-02', 0, 4), venta('normal', '2026-09-03', 16, 5)],
      NOMBRES,
      ZONAS,
      REGLAS_QA,
    );

    expect(results).toEqual([]);
    expect(insufficient.map((r) => [r.zoneName, r.reason])).toEqual([
      ['Nacional', 'Hay precios o cantidades no positivos.'],
      ['Zona A', 'Hay precios o cantidades no positivos.'],
    ]);
    for (const r of insufficient) {
      expect(Number.isFinite(r.observations) && Number.isFinite(r.distinctPrices)).toBe(true);
    }
  });

  it('el precio de cada observación es el promedio ponderado por unidades (ingreso entre unidades)', () => {
    // q = 36 · p^-2 → E = −2. El día 01 se vendieron 3 u a $2 y 1 u a $6:
    // su precio es $3 (12 / 4), no $4 (promedio simple). Solo así cae en la curva.
    expect(
      deZonaA([
        venta('normal', '2026-09-01', 3, 2),
        venta('normal', '2026-09-01', 1, 6),
        venta('normal', '2026-09-02', 9, 2),
        venta('normal', '2026-09-03', 1, 6),
      ]),
    ).toMatchObject({ value: -2, rSquared: 1, observations: 3 });
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

  it('promedia las zonas de cada segmento ponderando por observaciones, sin R², y solo las que le pertenecen', () => {
    const barras = aggregateBySegment(
      [
        { id: 1, name: 'Bajo' },
        { id: 2, name: 'Alto' },
      ],
      [
        { zoneId: 'z-valle', zoneName: 'Zona Valle', value: -4, rSquared: 0.9, observations: 4 },
        { zoneId: 'z-centro', zoneName: 'Zona Centro', value: -1, rSquared: 0.8, observations: 2 },
        // Sin clasificación vigente: no entra en ningún segmento.
        { zoneId: 'z-sin', zoneName: 'Zona sin segmento', value: -10, rSquared: 0.7, observations: 50 },
      ],
      new Map<string, number | null>([
        ['z-valle', 1],
        ['z-centro', 1],
        ['z-sin', null],
      ]),
    );

    // (−4 · 4 + −1 · 2) / 6 = −3; el promedio simple daría −2.5.
    expect(barras).toEqual([
      {
        key: '1',
        label: 'Bajo',
        value: -3,
        classification: 'elastic',
        observations: 6,
        rSquared: null,
        atypical: false,
        zones: ['Zona Centro', 'Zona Valle'],
      },
      { key: '2', label: 'Alto', value: null, classification: null, observations: 0, rSquared: null, atypical: null, zones: [] },
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
    const reporte = { terminada: jest.fn() };
    return new ElasticityService(
      { query } as unknown as DataSource,
      fuente as unknown as FuenteDatos,
      reporte as unknown as ReporteDeCorridas,
    );
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

  it('chart de una corrida mensual dice "por mes" y granularity sale como month (D-21)', async () => {
    const service = servicio([
      [{ ...corrida, granularity: 'month' }],
      [{ zoneId: null, value: '-1.2000', rSquared: null, observations: 20 }],
    ]);

    const grafico = await service.getComparativeChart({ presentationId: 'pres-1', runId: 'corrida-1' });

    expect(grafico.granularity).toBe('month');
    expect(grafico.note).toContain('observaciones por mes');
  });

  it('una corrida sin granularidad guardada (runs anteriores a D-21) no revienta: cae a semana', async () => {
    const service = servicio([
      [{ ...corrida, granularity: null }],
      [{ zoneId: null, value: '-1.2000', rSquared: null, observations: 20 }],
    ]);

    const grafico = await service.getComparativeChart({ presentationId: 'pres-1', runId: 'corrida-1' });

    expect(grafico.granularity).toBe('week');
    expect(grafico.note).toContain('observaciones por semana');
  });

  it('current marca atypical solo cuando E > 0', async () => {
    const fila = {
      presentationId: 'pres-1',
      rSquared: null,
      observations: 10,
      runId: 'corrida-1',
      executedAt: corrida.executedAt,
      periodStart: '2026-08-02',
      periodEnd: '2026-09-20',
      outdated: false,
    };
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

  it('current dice de qué periodo sale cada fila y si una corrida posterior no la pudo recalcular', async () => {
    const fila = { presentationId: 'pres-1', rSquared: null, observations: 10, value: '-2.0000', executedAt: corrida.executedAt };
    const service = servicio([
      [
        // La zona se quedó con la corrida vieja; el nacional ya es de la nueva.
        { ...fila, zoneId: 'z-oriente', runId: 'vieja', periodStart: '2026-08-02', periodEnd: '2026-09-20', outdated: true },
        { ...fila, zoneId: null, runId: 'nueva', periodStart: '2026-08-05', periodEnd: '2026-08-10', outdated: false },
      ],
    ]);

    const { data } = await service.current({});

    expect(data.map((e) => [e.zoneName, e.runId, e.periodStart, e.periodEnd, e.outdated])).toEqual([
      ['Zona Oriente', 'vieja', '2026-08-02', '2026-09-20', true],
      ['Nacional', 'nueva', '2026-08-05', '2026-08-10', false],
    ]);
  });
});

describe('estimateElasticities con las reglas vigentes (8 observaciones, 3 precios, efectos fijos)', () => {
  const NOMBRE = new Map([['arroz', { product: 'Arroz blanco', presentation: '500 g' }]]);
  const TRES_ZONAS = new Map([['baja', 'Zona Oriente'], ['media', 'Zona Centro'], ['alta', 'Zona Valle']]);
  // Semanas con precio en ciclo; cada zona sigue q = k · p^-0.6, pero la zona alta cobra 20 % más
  // y vende el triple (tamaño e ingreso): es lo que volteaba el signo del agregado nacional.
  const semanas = (zona: string, nivelPrecio: number, nivelCantidad: number, n = 8) =>
    Array.from({ length: n }, (_, t) => {
      const precio = nivelPrecio * [0.9, 1, 1.1, 0.95][t % 4];
      return venta('arroz', `2026-W${10 + t}`, nivelCantidad * 100 * precio ** -0.6, precio, zona);
    });

  it('el nacional recupera la elasticidad de las zonas aunque la zona grande cobre más', () => {
    const { results } = estimateElasticities(
      [...semanas('baja', 16, 1), ...semanas('media', 18, 1.5), ...semanas('alta', 19.2, 3)],
      NOMBRE,
      TRES_ZONAS,
    );
    const nacional = results.find((r) => r.zoneId === null)!;
    expect(nacional).toMatchObject({ zoneName: 'Nacional', observations: 24, atypical: false });
    expect(nacional.value).toBeCloseTo(-0.6, 3);
    for (const zona of results.filter((r) => r.zoneId !== null)) expect(zona.value).toBeCloseTo(-0.6, 3);
  });

  it('con 3 semanas no publica: el motivo dice el mínimo nuevo', () => {
    const { results, insufficient } = estimateElasticities(semanas('baja', 16, 1, 3), NOMBRE, TRES_ZONAS);
    expect(results).toEqual([]);
    expect(insufficient.map((r) => r.reason)).toEqual([
      'Solo 3 observación(es); se necesitan al menos 8.',
      'Solo 3 observación(es); se necesitan al menos 8.',
    ]);
  });

  it('cantidad constante sale como insuficiente con su motivo, nunca E = 0 inelástica', () => {
    const fijas = Array.from({ length: 8 }, (_, t) => venta('arroz', `2026-W${10 + t}`, 20, [16, 17, 18][t % 3], 'baja'));
    const { results, insufficient } = estimateElasticities(fijas, NOMBRE, TRES_ZONAS);
    expect(results).toEqual([]);
    expect(insufficient[0].reason).toBe(
      'La cantidad vendida no cambió en el periodo: no se puede medir cómo reacciona la demanda al precio.',
    );
  });
});
