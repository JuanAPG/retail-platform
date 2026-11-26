import { IndicatorsService, TIMEOUT_SERVICIOS_MS } from './indicators.service';
import { ParametrosReporte } from './schemas/report.schema';

const params: ParametrosReporte = { dateFrom: '2026-08-01', dateTo: '2026-08-31', zoneId: null, segmentId: null };

/** Respuesta de fetch con el cuerpo dado. */
const ok = (cuerpo: unknown) => ({ ok: true, status: 200, json: async () => cuerpo }) as Response;
const http = (status: number) => ({ ok: false, status, json: async () => ({}) }) as Response;

/** Rutas → respuesta; lo que no esté en el mapa devuelve 404. */
function simular(rutas: Record<string, () => Response | Promise<Response>>) {
  const llamadas: string[] = [];
  global.fetch = jest.fn(async (url: string | URL | Request) => {
    const u = String(url);
    llamadas.push(u);
    const clave = Object.keys(rutas).find((r) => u.includes(r));
    return clave ? rutas[clave]() : http(404);
  }) as unknown as typeof fetch;
  return llamadas;
}

const porClave = (r: Awaited<ReturnType<IndicatorsService['reunir']>>, clave: string) => r.find((i) => i.clave === clave)!;

afterEach(() => jest.restoreAllMocks());

describe('IndicatorsService.reunir', () => {
  it('devuelve exactamente los 16 indicadores del reporte (D-20), cada uno con su servicio', async () => {
    simular({});
    const r = await new IndicatorsService().reunir(params, 'Bearer t');

    expect(r).toHaveLength(16);
    expect(new Set(r.map((i) => i.clave)).size).toBe(16);
    const porServicio = r.reduce<Record<string, number>>((a, i) => ({ ...a, [i.servicio]: (a[i.servicio] ?? 0) + 1 }), {});
    expect(porServicio).toEqual({
      'core-process-service': 6,
      'catalog-service': 2,
      'algorithms-core': 4,
      'pricing-service': 1,
      'decision-service': 3,
    });
  });

  it('un servicio caído deja SUS indicadores como no disponibles, con motivo y sin valor (nunca 0)', async () => {
    simular({
      '/v1/analytics/average-ticket': () => ok(86.4),
      '/v1/analytics/products-per-basket': () => http(503),
    });
    const r = await new IndicatorsService().reunir(params, 'Bearer t');

    expect(porClave(r, 'ticket_promedio')).toMatchObject({ disponible: true, valor: 86.4, motivo: null });
    const caido = porClave(r, 'productos_por_canasta');
    expect(caido).toMatchObject({ disponible: false, valor: null });
    expect(caido.motivo).toMatch(/core-process-service respondió HTTP 503/);
  });

  it('un 404 de negocio (zona sin accesibilidad calculada) es disponible con valor null, no una caída (QA-DOC54-02)', async () => {
    simular({
      '/v1/zones': () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'z1', nombre: 'Norte' }], total: 1 }) }) as Response,
      '/v1/accessibility/by-zone/z1': () => http(404),
      '/v1/simulation/scenarios': () => http(503),
    });
    const r = await new IndicatorsService().reunir(params, 'Bearer t');

    expect(porClave(r, 'accesibilidad_por_zona')).toMatchObject({ disponible: true, valor: [], motivo: null });
    expect(porClave(r, 'escenarios_creados')).toMatchObject({ disponible: false, valor: null });
  });

  it('un timeout de 3 s marca el indicador como no disponible, no como 0', async () => {
    global.fetch = jest.fn((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
      }),
    ) as unknown as typeof fetch;
    jest.useFakeTimers();

    const promesa = new IndicatorsService().reunir(params, undefined);
    await jest.advanceTimersByTimeAsync(TIMEOUT_SERVICIOS_MS + 50);
    const r = await promesa;
    jest.useRealTimers();

    expect(r.every((i) => !i.disponible && i.valor === null)).toBe(true);
    expect(porClave(r, 'ticket_promedio').motivo).toBe('core-process-service no respondió en 3 s.');
  });

  it('reenvía el Authorization del usuario a los servicios y manda los filtros del periodo', async () => {
    simular({ '/v1/analytics/average-ticket': () => ok(10) });
    await new IndicatorsService().reunir({ ...params, zoneId: 'zona-1', segmentId: 2 }, 'Bearer abc');

    const llamada = (global.fetch as jest.Mock).mock.calls.find(([u]) => String(u).includes('average-ticket'))!;
    expect(llamada[1].headers.Authorization).toBe('Bearer abc');
    const url = new URL(String(llamada[0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({ dateFrom: '2026-08-01', dateTo: '2026-08-31', zoneId: 'zona-1', segmentId: '2' });
  });

  it('un indicador sin datos en el periodo es disponible, no un error', async () => {
    simular({
      '/v1/analytics/spend-by-category': () => ok([]),
      '/v1/elasticity/current': () => ok({ data: [], total: 0 }),
    });
    const r = await new IndicatorsService().reunir(params, 't');

    expect(porClave(r, 'categorias_principales')).toMatchObject({ disponible: true, valor: [] });
    expect(porClave(r, 'elasticidad_promedio')).toMatchObject({ disponible: true, valor: null });
  });

  it('elasticidad promedio y productos más sensibles salen de /elasticity/current', async () => {
    simular({
      '/v1/elasticity/current': () =>
        ok({
          total: 3,
          data: [
            { value: -0.5, productName: 'Arroz', presentationName: '1 kg', zoneName: 'Centro', classification: 'inelastic' },
            { value: -2, productName: 'Leche', presentationName: '1 L', zoneName: 'Centro', classification: 'elastic' },
            { value: -1.5, productName: 'Atún', presentationName: '140 g', zoneName: 'Centro', classification: 'elastic' },
          ],
        }),
    });
    const r = await new IndicatorsService().reunir(params, 't');

    expect(porClave(r, 'elasticidad_promedio').valor).toBe(-1.333);
    const sensibles = porClave(r, 'productos_mas_sensibles').valor as Array<{ producto: string }>;
    expect(sensibles.map((s) => s.producto)).toEqual(['Leche', 'Atún', 'Arroz']);
  });

  it('las cifras de core-process pasan tal cual: ticket promedio y canastas', async () => {
    simular({
      '/v1/analytics/average-ticket': () => ok(142.75),
      '/v1/transactions': () => ok({ data: [], total: 100, page: 1, limit: 1 }),
    });
    const r = await new IndicatorsService().reunir(params, 't');

    expect(porClave(r, 'ticket_promedio').valor).toBe(142.75);
    expect(porClave(r, 'canastas').valor).toBe(100);
    expect(porClave(r, 'transacciones_analizadas').valor).toBe(100);
  });

  it('la accesibilidad lee el historial por zona y NO el cálculo (que crearía una corrida nueva)', async () => {
    const llamadas = simular({
      '/v1/zones': () => ok({ data: [{ id: 'z1', nombre: 'Centro' }], total: 1 }),
      '/v1/accessibility/by-zone/z1': () => ok({ indexValue: 0.62, calculatedAt: '2026-09-20T12:00:00.000Z' }),
    });
    const r = await new IndicatorsService().reunir(params, 't');

    expect(porClave(r, 'accesibilidad_por_zona').valor).toEqual([
      { zonaId: 'z1', zona: 'Centro', indice: 0.62, calculadoEn: '2026-09-20T12:00:00.000Z' },
    ]);
    expect(llamadas.some((u) => u.includes('/v1/accessibility/index'))).toBe(false);
  });

  it('accesibilidad: by-zone devuelve el historial (arreglo) y se toma la corrida más reciente', async () => {
    // Forma vigente de decision-service desde el arreglo del fallo #10: un
    // arreglo ordenado de la más reciente a la más antigua.
    simular({
      '/v1/zones': () => ok({ data: [{ id: 'z1', nombre: 'Centro' }], total: 1 }),
      '/v1/accessibility/by-zone/z1': () =>
        ok([
          { indexValue: 0.62, calculatedAt: '2026-09-20T12:00:00.000Z' },
          { indexValue: 0.4, calculatedAt: '2026-08-01T12:00:00.000Z' },
        ]),
    });
    const r = await new IndicatorsService().reunir(params, 't');

    expect(porClave(r, 'accesibilidad_por_zona').valor).toEqual([
      { zonaId: 'z1', zona: 'Centro', indice: 0.62, calculadoEn: '2026-09-20T12:00:00.000Z' },
    ]);
  });

  it('accesibilidad: una zona con historial VACÍO (200 []) se omite, igual que antes el 404', async () => {
    simular({
      '/v1/zones': () => ok({ data: [{ id: 'z1', nombre: 'Centro' }, { id: 'z2', nombre: 'Oriente' }], total: 2 }),
      '/v1/accessibility/by-zone/z1': () => ok([{ indexValue: 0.62, calculatedAt: '2026-09-20T12:00:00.000Z' }]),
      '/v1/accessibility/by-zone/z2': () => ok([]),
    });
    const r = await new IndicatorsService().reunir(params, 't');

    // D-20: el indicador sigue disponible; solo falta la zona sin corridas.
    expect(porClave(r, 'accesibilidad_por_zona')).toMatchObject({ disponible: true, motivo: null });
    expect(porClave(r, 'accesibilidad_por_zona').valor).toEqual([
      { zonaId: 'z1', zona: 'Centro', indice: 0.62, calculadoEn: '2026-09-20T12:00:00.000Z' },
    ]);
  });

  it('accesibilidad con varias zonas: la que no tiene corrida (404) se omite y las demás entregan su valor (QA-DOC54-02)', async () => {
    simular({
      '/v1/zones': () => ok({ data: [{ id: 'z1', nombre: 'Centro' }, { id: 'z2', nombre: 'Oriente' }, { id: 'z3', nombre: 'Valle' }], total: 3 }),
      '/v1/accessibility/by-zone/z1': () => ok({ indexValue: 0.5468, calculatedAt: '2026-09-20T12:00:00.000Z' }),
      '/v1/accessibility/by-zone/z2': () => http(404),
      '/v1/accessibility/by-zone/z3': () => ok({ indexValue: 0.6667, calculatedAt: '2026-09-21T12:00:00.000Z' }),
    });
    const r = await new IndicatorsService().reunir(params, 't');

    expect(porClave(r, 'accesibilidad_por_zona')).toMatchObject({ disponible: true, motivo: null });
    expect(porClave(r, 'accesibilidad_por_zona').valor).toEqual([
      { zonaId: 'z1', zona: 'Centro', indice: 0.5468, calculadoEn: '2026-09-20T12:00:00.000Z' },
      { zonaId: 'z3', zona: 'Valle', indice: 0.6667, calculadoEn: '2026-09-21T12:00:00.000Z' },
    ]);
  });

  it('sustituciones: una categoría sin patrones (404) no aborta el recorrido ni pierde lo acumulado', async () => {
    simular({
      '/v1/product-categories': () => ok([{ id: 1 }, { id: 2 }, { id: 3 }]),
      'categoryId=1': () => ok([{ originProductName: 'A', targetProductName: 'B', type: 'directa' }]),
      'categoryId=2': () => http(404),
      'categoryId=3': () => ok([{ originProductName: 'C', targetProductName: 'D', type: 'directa' }]),
    });
    const r = await new IndicatorsService().reunir(params, 't');

    expect(porClave(r, 'sustituciones')).toMatchObject({ disponible: true, valor: { total: 2 } });
  });

  it('un servicio caído en sustituciones (5xx) sí marca el indicador como no disponible', async () => {
    simular({
      '/v1/product-categories': () => ok([{ id: 1 }]),
      'categoryId=1': () => http(503),
    });
    const r = await new IndicatorsService().reunir(params, 't');

    expect(porClave(r, 'sustituciones')).toMatchObject({ disponible: false, valor: null });
  });

  it('asociaciones y variación de precios con 404 no tumban el indicador entero', async () => {
    simular({
      '/v1/association/runs': () => http(404),
      '/v1/products': () => ok({ data: [{ id: 'p1' }, { id: 'p2' }], total: 2 }),
      '/v1/prices/history': () => http(404),
    });
    const r = await new IndicatorsService().reunir(params, 't');

    expect(porClave(r, 'asociaciones_principales')).toMatchObject({ disponible: true, valor: { corrida: null, reglas: [] } });
    expect(porClave(r, 'variacion_precios')).toMatchObject({ disponible: true, motivo: null });
  });
});

describe('escenarios_creados e impacto_estimado (forma actual de decision-service)', () => {
  const esc = (id: string, type: string, createdAt: string, name = `Escenario ${id}`) => ({ id, name, type, zoneId: 'z-1', createdAt });
  /** GET /simulation/scenarios paginado: `lista` repartida en páginas de `limit`. */
  function paginado(lista: ReturnType<typeof esc>[], porPagina = 100) {
    return (url: string) => {
      const q = new URL(url).searchParams;
      const page = Number(q.get('page') ?? 1);
      const limit = Math.min(Number(q.get('limit') ?? 20), porPagina);
      return ok({ data: lista.slice((page - 1) * limit, page * limit), total: lista.length, page, limit });
    };
  }
  /** GET /simulation/compare: `scenarios[].results[]` con ingreso_estimado por escenario. */
  function compare(ingresos: Record<string, number>, pedidos: string[][]) {
    return (url: string) => {
      const ids = (new URL(url).searchParams.get('ids') ?? '').split(',');
      pedidos.push(ids);
      return ok({
        scenarioIds: ids,
        scenarios: ids.map((id) => ({
          scenarioId: id, name: id, type: 'precio', zoneId: 'z-1', elasticity: -2, elasticityRunId: null,
          results: id in ingresos
            ? [
                { indicatorKey: 'demanda_estimada', zoneId: 'z-1', baseValue: 1000, simulatedValue: 826, difference: -174, variationPct: -17.4 },
                { indicatorKey: 'ingreso_estimado', zoneId: 'z-1', baseValue: 25000, simulatedValue: ingresos[id], difference: ingresos[id] - 25000, variationPct: -9.14 },
              ]
            : [],
        })),
        warnings: [],
      });
    };
  }
  function simularUrl(rutas: Record<string, (url: string) => Response>) {
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const clave = Object.keys(rutas).find((r) => u.includes(r));
      return clave ? rutas[clave](u) : http(404);
    }) as unknown as typeof fetch;
  }
  const EN = '2026-08-10T12:00:00.000Z';
  const FUERA = '2026-09-02T12:00:00.000Z';

  it('cero escenarios: conteo 0 e impacto [] (disponibles, sin llamar a compare)', async () => {
    const pedidos: string[][] = [];
    simularUrl({ '/v1/simulation/scenarios': paginado([]), '/v1/simulation/compare': compare({}, pedidos) });
    const r = await new IndicatorsService().reunir(params, 't');
    expect(porClave(r, 'escenarios_creados')).toMatchObject({ disponible: true, valor: 0 });
    expect(porClave(r, 'impacto_estimado')).toMatchObject({ disponible: true, valor: [] });
    expect(pedidos).toHaveLength(0);
  });

  it('un escenario de precio: se compara con un acompañante y solo se reporta el de precio', async () => {
    const pedidos: string[][] = [];
    simularUrl({
      '/v1/simulation/scenarios': paginado([esc('a', 'precio', EN, 'Leche +10 %'), esc('b', 'presentacion', EN)]),
      '/v1/simulation/compare': compare({ a: 22715 }, pedidos),
    });
    const r = await new IndicatorsService().reunir(params, 't');
    expect(porClave(r, 'escenarios_creados').valor).toBe(2);
    expect(porClave(r, 'impacto_estimado').valor).toEqual([
      { escenario: 'Leche +10 %', zonaId: 'z-1', ingresoBase: 25000, ingresoEstimado: 22715, variacionPct: -9.14 },
    ]);
    expect(pedidos).toEqual([['a', 'b']]);
  });

  it('un único escenario en todo decision-service: el impacto queda null (nunca 0) y no se llama a compare', async () => {
    const pedidos: string[][] = [];
    simularUrl({ '/v1/simulation/scenarios': paginado([esc('a', 'precio', EN, 'Solo')]), '/v1/simulation/compare': compare({ a: 1 }, pedidos) });
    const r = await new IndicatorsService().reunir(params, 't');
    expect(porClave(r, 'impacto_estimado').valor).toEqual([{ escenario: 'Solo', zonaId: 'z-1', ingresoBase: null, ingresoEstimado: null, variacionPct: null }]);
    expect(pedidos).toHaveLength(0);
  });

  it('dos escenarios de precio: simulatedValue de ingreso_estimado de cada uno', async () => {
    const pedidos: string[][] = [];
    simularUrl({
      '/v1/simulation/scenarios': paginado([esc('a', 'precio', EN, 'A'), esc('b', 'precio', EN, 'B')]),
      '/v1/simulation/compare': compare({ a: 22715, b: 26000 }, pedidos),
    });
    const r = await new IndicatorsService().reunir(params, 't');
    const v = porClave(r, 'impacto_estimado').valor as Array<{ escenario: string; ingresoEstimado: number }>;
    expect(v.map((x) => [x.escenario, x.ingresoEstimado])).toEqual([['A', 22715], ['B', 26000]]);
  });

  it('escenarios fuera del periodo no cuentan ni entran al impacto (pero pueden servir de acompañante)', async () => {
    const pedidos: string[][] = [];
    simularUrl({
      '/v1/simulation/scenarios': paginado([esc('a', 'precio', EN, 'Dentro'), esc('x', 'precio', FUERA, 'Fuera'), esc('y', 'precio', '2026-07-31T23:00:00.000Z')]),
      '/v1/simulation/compare': compare({ a: 22715, x: 99999 }, pedidos),
    });
    const r = await new IndicatorsService().reunir(params, 't');
    expect(porClave(r, 'escenarios_creados').valor).toBe(1);
    const v = porClave(r, 'impacto_estimado').valor as Array<{ escenario: string }>;
    expect(v.map((x) => x.escenario)).toEqual(['Dentro']);
  });

  it('más de una página: cuenta todo (250 escenarios en 3 páginas) y compara en lotes de 20', async () => {
    const pedidos: string[][] = [];
    const lista = Array.from({ length: 250 }, (_, i) => esc(`e${i}`, i < 45 ? 'precio' : 'presentacion', EN));
    const ingresos = Object.fromEntries(lista.slice(0, 45).map((e) => [e.id, 1000]));
    simularUrl({ '/v1/simulation/scenarios': paginado(lista), '/v1/simulation/compare': compare(ingresos, pedidos) });
    const r = await new IndicatorsService().reunir(params, 't');
    expect(porClave(r, 'escenarios_creados').valor).toBe(250);
    const v = porClave(r, 'impacto_estimado').valor as Array<{ ingresoEstimado: number | null }>;
    expect(v).toHaveLength(45);
    expect(v.every((x) => x.ingresoEstimado === 1000)).toBe(true);
    expect(pedidos.every((ids) => ids.length >= 2 && ids.length <= 20)).toBe(true);
  });

  it('las tarjetas dicen si el valor es vigente o de la última corrida', async () => {
    simularUrl({});
    const r = await new IndicatorsService().reunir(params, 't');
    expect(porClave(r, 'elasticidad_promedio').nombre).toMatch(/vigentes hoy/);
    expect(porClave(r, 'productos_mas_sensibles').nombre).toMatch(/vigente/);
    expect(porClave(r, 'accesibilidad_por_zona').nombre).toMatch(/última corrida/);
  });
});
