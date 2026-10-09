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
      '/v1/accessibility/by-zone/z1': () => ok([{ indexValue: 0.62, calculatedAt: '2026-09-20T12:00:00.000Z' }]),
    });
    const r = await new IndicatorsService().reunir(params, 't');

    expect(porClave(r, 'accesibilidad_por_zona').valor).toEqual([
      { zonaId: 'z1', zona: 'Centro', indice: 0.62, calculadoEn: '2026-09-20T12:00:00.000Z' },
    ]);
    expect(llamadas.some((u) => u.includes('/v1/accessibility/index'))).toBe(false);
  });
});
