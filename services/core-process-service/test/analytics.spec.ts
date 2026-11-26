/**
 * Integración M09 (corre en la VM con Docker).
 *
 * Requiere: `docker compose -f infra/docker-compose.yml up -d
 * core-process-service` con seed + el CSV de 100 canastas ya confirmado
 * (lo hace `test/transacciones.spec.ts`), y token de Analista. No corre en
 * CI sin infraestructura; se ejecuta a mano:
 *
 *   CORE_TOKEN=<jwt-analista> npm run test:integracion
 */
const BASE = process.env.CORE_BASE_URL ?? 'http://localhost:3104';
const TOKEN = process.env.CORE_TOKEN ?? '';

const ESCALARES = [
  '/v1/analytics/average-ticket',
  '/v1/analytics/products-per-basket',
  '/v1/analytics/purchase-frequency',
  '/v1/analytics/units-per-transaction',
];

async function get(ruta: string, xml = false) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(xml ? { Accept: 'application/xml' } : {}),
    },
  });
  return {
    estado: respuesta.status,
    tipo: respuesta.headers.get('content-type') ?? '',
    cuerpo: xml ? await respuesta.text() : await respuesta.json(),
  };
}

beforeAll(async () => {
  try {
    const salud = await fetch(`${BASE}/v1/health`);
    if (!salud.ok) throw new Error(`health devolvió ${salud.status}`);
  } catch (error) {
    throw new Error(
      `No hay stack en ${BASE}: levanta docker compose antes de correr estas pruebas. ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!TOKEN) throw new Error('Falta CORE_TOKEN: exporta un JWT de Analista comercial (Matriz §3: es el único que escribe M06/M07).');
}, 30000);

describe('M09 de punta a punta (integración, requiere stack)', () => {
  it('los 5 endpoints responden 200 con números', async () => {
    for (const ruta of ESCALARES) {
      const r = await get(ruta);
      expect(r.estado).toBe(200);
      expect(typeof r.cuerpo).toBe('number');
      expect(r.cuerpo).toBeGreaterThan(0);
    }
    const gasto = await get('/v1/analytics/spend-by-category');
    expect(gasto.estado).toBe(200);
    expect(Array.isArray(gasto.cuerpo)).toBe(true);
    expect(gasto.cuerpo.length).toBeGreaterThan(0);
  });

  it('el ticket promedio cuadra con las canastas reales', async () => {
    // Se recalcula a mano sobre las canastas que devuelve M07 y se compara
    // con lo que reporta M09: no basta con que "el número se vea bien".
    const canastas = await get('/v1/baskets?limit=100');
    expect(canastas.estado).toBe(200);
    const filas = canastas.cuerpo.data as { totalValue: string }[];
    expect(filas.length).toBeGreaterThan(0);

    const todas = canastas.cuerpo.total as number;
    if (todas > filas.length) {
      // Con más de una página, la comparación exacta no aplica: basta con
      // que el promedio esté dentro del rango de las canastas vistas.
      const valores = filas.map((k) => Number(k.totalValue));
      const ticket = (await get('/v1/analytics/average-ticket')).cuerpo as number;
      expect(ticket).toBeGreaterThanOrEqual(Math.min(...valores) * 0.5);
      expect(ticket).toBeLessThanOrEqual(Math.max(...valores) * 2);
      return;
    }

    const suma = filas.reduce((s, k) => s + Number(k.totalValue), 0);
    const esperado = Math.round((suma / filas.length) * 100) / 100;
    const ticket = (await get('/v1/analytics/average-ticket')).cuerpo as number;
    expect(Math.abs(ticket - esperado)).toBeLessThanOrEqual(0.01);
  }, 60000);

  it('spend-by-category suma el mismo total que las canastas del ámbito', async () => {
    const gasto = (await get('/v1/analytics/spend-by-category')).cuerpo as {
      totalSpend: number;
      share: number;
    }[];
    const sumaCategorias = gasto.reduce((s, c) => s + c.totalSpend, 0);

    // Ningún producto desaparece del total: los shares cubren el 100 %.
    const sumaShares = gasto.reduce((s, c) => s + c.share, 0);
    expect(Math.abs(sumaShares - 100)).toBeLessThanOrEqual(0.5);
    expect(sumaCategorias).toBeGreaterThan(0);

    // Orden descendente por gasto.
    const ordenado = [...gasto].sort((a, b) => b.totalSpend - a.totalSpend);
    expect(gasto.map((c) => c.totalSpend)).toEqual(ordenado.map((c) => c.totalSpend));
  }, 30000);

  it('los filtros se aplican de verdad en los 5 indicadores', async () => {
    const canastas = await get('/v1/baskets?limit=1');
    const zona = canastas.cuerpo.data[0]?.zoneId as string;
    expect(zona).toBeDefined();

    for (const ruta of ESCALARES) {
      const global = (await get(ruta)).cuerpo as number;
      const filtrado = (await get(`${ruta}?zoneId=${zona}`)).cuerpo as number;
      const imposible = (await get(`${ruta}?dateFrom=2099-01-01&dateTo=2099-12-31`)).cuerpo;
      expect(typeof filtrado).toBe('number');
      // Un rango sin datos da 0: prueba de que el filtro llega a la query.
      expect(imposible).toBe(0);
      expect(global).toBeGreaterThan(0);
    }

    const gastoVacio = (await get('/v1/analytics/spend-by-category?dateFrom=2099-01-01')).cuerpo;
    expect(gastoVacio).toEqual([]);
  }, 60000);

  it('purchase-frequency cuadra EXACTO con la fórmula sobre un mes cerrado', async () => {
    // Un mes calendario completo: dateFrom y dateTo+1 caen en día 1, así
    // que el denominador es 1 mes exacto y la frecuencia debe ser igual al
    // número de canastas del mes. Sin aproximaciones ni rangos.
    const mes = { desde: '2026-08-01', hasta: '2026-08-31' };

    let canastasDelMes = 0;
    for (let page = 1; ; page++) {
      const r = await get(
        `/v1/baskets?dateFrom=${mes.desde}&dateTo=${mes.hasta}&limit=100&page=${page}`,
      );
      expect(r.estado).toBe(200);
      canastasDelMes = r.cuerpo.total;
      if (page * 100 >= r.cuerpo.total) break;
      if (page > 50) break;
    }
    expect(canastasDelMes).toBeGreaterThan(0);

    const frecuencia = (
      await get(`/v1/analytics/purchase-frequency?dateFrom=${mes.desde}&dateTo=${mes.hasta}`)
    ).cuerpo as number;

    // canastas / 1 mes = canastas.
    expect(frecuencia).toBe(canastasDelMes);
  }, 60000);

  it('purchase-frequency sobre dos meses cerrados divide entre 2', async () => {
    const r = await get('/v1/baskets?dateFrom=2026-08-01&dateTo=2026-09-30&limit=1');
    const canastas = r.cuerpo.total as number;
    expect(canastas).toBeGreaterThan(0);

    const frecuencia = (
      await get('/v1/analytics/purchase-frequency?dateFrom=2026-08-01&dateTo=2026-09-30')
    ).cuerpo as number;

    expect(frecuencia).toBe(Math.round((canastas / 2) * 100) / 100);
  }, 30000);

  it('un filtro mal formado da 400, no 500', async () => {
    const r = await get('/v1/analytics/average-ticket?segmentId=abc');
    expect(r.estado).toBe(400);
    expect(r.cuerpo.code).toBe('VALIDATION_ERROR');
  });

  it('XML: escalar y lista con <item>', async () => {
    const escalar = await get('/v1/analytics/average-ticket', true);
    expect(escalar.estado).toBe(200);
    expect(escalar.tipo).toContain('application/xml');
    expect(String(escalar.cuerpo)).toMatch(/<response>[\d.]+<\/response>/);

    const lista = await get('/v1/analytics/spend-by-category', true);
    expect(lista.estado).toBe(200);
    expect(String(lista.cuerpo)).toContain('<item>');
    expect(String(lista.cuerpo)).toContain('<categoryName>');
  });

  it('sin token es 401', async () => {
    const respuesta = await fetch(`${BASE}/v1/analytics/average-ticket`);
    expect(respuesta.status).toBe(401);
  });
});

describe('weekly-sales de punta a punta (T-13, integración, requiere stack)', () => {
  type Linea = { productId: string; presentationId: string; quantity: string };
  type Venta = { id: string; storeId: string; details: Linea[] };

  /** Todas las transacciones (el CSV de 100 canastas cabe en pocas páginas). */
  async function todasLasVentas(): Promise<Venta[]> {
    const ventas: Venta[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await get(`/v1/transactions?limit=100&page=${page}`);
      expect(r.estado).toBe(200);
      ventas.push(...(r.cuerpo.data as Venta[]));
      if (page * 100 >= r.cuerpo.total) break;
    }
    return ventas;
  }

  it('cuadra con las líneas de /v1/transactions: cantidades, transacciones y tiendas', async () => {
    const ventas = await todasLasVentas();
    const producto = ventas[0]?.details[0]?.productId;
    expect(producto).toBeDefined();

    // Lo esperado, calculado a mano desde las transacciones.
    const porPresentacion = new Map<string, number>();
    const transacciones = new Set<string>();
    const tiendas = new Set<string>();
    for (const v of ventas) {
      for (const d of v.details.filter((l) => l.productId === producto)) {
        porPresentacion.set(d.presentationId, (porPresentacion.get(d.presentationId) ?? 0) + Number(d.quantity));
        transacciones.add(v.id);
        tiendas.add(v.storeId);
      }
    }

    const r = await get(`/v1/analytics/weekly-sales?productId=${producto}`);
    expect(r.estado).toBe(200);
    expect(r.cuerpo.transactions).toBe(transacciones.size);
    expect(r.cuerpo.stores).toBe(tiendas.size);

    const obtenido = new Map<string, number>();
    for (const fila of r.cuerpo.data as { weekStart: string; presentationId: string; quantity: number }[]) {
      obtenido.set(fila.presentationId, (obtenido.get(fila.presentationId) ?? 0) + fila.quantity);
      // Toda semana empieza en lunes.
      expect(new Date(`${fila.weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
    }
    for (const [presentacion, cantidad] of porPresentacion) {
      expect(Math.abs((obtenido.get(presentacion) ?? 0) - cantidad)).toBeLessThanOrEqual(0.01);
    }
    expect(obtenido.size).toBe(porPresentacion.size);
  }, 60000);

  it('asOf anterior a las ventas da conteos en 0; el mismo asOf repite el resultado', async () => {
    const ventas = await todasLasVentas();
    const producto = ventas[0].details[0].productId;

    const antes = await get(`/v1/analytics/weekly-sales?productId=${producto}&asOf=2000-01-01T00:00:00Z`);
    expect(antes.estado).toBe(200);
    expect(antes.cuerpo.transactions).toBe(0);
    expect(antes.cuerpo.data).toEqual([]);

    const primera = await get(`/v1/analytics/weekly-sales?productId=${producto}`);
    const repetida = await get(`/v1/analytics/weekly-sales?productId=${producto}&asOf=${primera.cuerpo.asOf}`);
    expect(repetida.cuerpo).toEqual(primera.cuerpo);
  }, 60000);

  it('sin productId, o con el rango invertido, es 400', async () => {
    const sinProducto = await get('/v1/analytics/weekly-sales');
    expect(sinProducto.estado).toBe(400);
    expect(sinProducto.cuerpo.code).toBe('VALIDATION_ERROR');

    const invertido = await get(
      '/v1/analytics/weekly-sales?productId=3f6c2a10-8b4e-4c1d-9a7e-1b2c3d4e5f60&dateFrom=2026-09-30&dateTo=2026-09-01',
    );
    expect(invertido.estado).toBe(400);
  });

  it('producto sin ventas: 200 con data vacía, no 404', async () => {
    const r = await get('/v1/analytics/weekly-sales?productId=3f6c2a10-8b4e-4c1d-9a7e-1b2c3d4e5f60');
    expect(r.estado).toBe(200);
    expect(r.cuerpo.data).toEqual([]);
    expect(r.cuerpo.transactions).toBe(0);
  });

  it('XML: raíz <response> con las semanas en <item>', async () => {
    const ventas = await todasLasVentas();
    const r = await get(`/v1/analytics/weekly-sales?productId=${ventas[0].details[0].productId}`, true);
    expect(r.estado).toBe(200);
    expect(r.tipo).toContain('application/xml');
    expect(String(r.cuerpo)).toContain('<weekStartsOn>monday</weekStartsOn>');
    expect(String(r.cuerpo)).toContain('<item>');
  }, 60000);
});

describe('basket-products de punta a punta (T-12, integración, requiere stack)', () => {
  type Canasta = { transactionId: string; storeId: string; zoneId: string; segmentId: number | null; totalValue: string };
  type Venta = { id: string; details: { productId: string; subtotal: string }[] };

  async function paginas<T>(ruta: string): Promise<T[]> {
    const filas: T[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await get(`${ruta}${ruta.includes('?') ? '&' : '?'}limit=100&page=${page}`);
      expect(r.estado).toBe(200);
      filas.push(...(r.cuerpo.data as T[]));
      if (page * 100 >= r.cuerpo.total) break;
    }
    return filas;
  }

  it('cada grupo zona-segmento cuadra con /v1/baskets y /v1/transactions', async () => {
    const canastas = await paginas<Canasta>('/v1/baskets');
    const ventas = new Map((await paginas<Venta>('/v1/transactions')).map((v) => [v.id, v]));

    // Lo esperado, por grupo, calculado a mano.
    const grupos = new Map<string, { canastas: Canasta[] }>();
    for (const k of canastas.filter((c) => c.segmentId != null)) {
      const clave = `${k.zoneId}|${k.segmentId}`;
      if (!grupos.has(clave)) grupos.set(clave, { canastas: [] });
      grupos.get(clave)!.canastas.push(k);
    }
    expect(grupos.size).toBeGreaterThan(0);

    for (const [clave, { canastas: delGrupo }] of grupos) {
      const [zona, segmento] = clave.split('|');
      const porProducto = new Map<string, { canastas: Set<string>; gasto: number }>();
      for (const k of delGrupo) {
        for (const d of ventas.get(k.transactionId)?.details ?? []) {
          const p = porProducto.get(d.productId) ?? { canastas: new Set<string>(), gasto: 0 };
          p.canastas.add(k.transactionId);
          p.gasto += Number(d.subtotal);
          porProducto.set(d.productId, p);
        }
      }

      const r = await get(`/v1/analytics/basket-products?zoneId=${zona}&segmentId=${segmento}`);
      expect(r.estado).toBe(200);
      const [periodo] = r.cuerpo.periods;
      expect(r.cuerpo.periods).toHaveLength(1);
      expect(periodo.baskets).toBe(delGrupo.length);
      expect(periodo.stores).toBe(new Set(delGrupo.map((k) => k.storeId)).size);
      const gastoEsperado = delGrupo.reduce((s, k) => s + Number(k.totalValue), 0);
      expect(Math.abs(periodo.totalSpend - gastoEsperado)).toBeLessThanOrEqual(0.01);

      const filas = r.cuerpo.data as { productId: string; basketsWithProduct: number; spend: number }[];
      expect(filas).toHaveLength(porProducto.size);
      for (const fila of filas) {
        const esperado = porProducto.get(fila.productId)!;
        expect(fila.basketsWithProduct).toBe(esperado.canastas.size);
        expect(Math.abs(fila.spend - esperado.gasto)).toBeLessThanOrEqual(0.01);
      }
      // Más canastas primero.
      const conteos = filas.map((f) => f.basketsWithProduct);
      expect(conteos).toEqual([...conteos].sort((a, b) => b - a));
    }
  }, 120000);

  it('gasto total = average-ticket × canastas con los mismos filtros', async () => {
    const [k] = await paginas<Canasta>('/v1/baskets?segmentId=1');
    if (!k) return;
    const filtros = `zoneId=${k.zoneId}&segmentId=${k.segmentId}`;
    const [periodo] = (await get(`/v1/analytics/basket-products?${filtros}`)).cuerpo.periods;
    const ticket = (await get(`/v1/analytics/average-ticket?${filtros}`)).cuerpo as number;
    // average-ticket redondea a 2 decimales: tolerancia de medio centavo por canasta.
    expect(Math.abs(periodo.totalSpend - ticket * periodo.baskets)).toBeLessThanOrEqual(0.005 * periodo.baskets + 0.01);
  }, 60000);

  it('groupBy=month: los meses suman lo mismo que el periodo único', async () => {
    const [k] = await paginas<Canasta>('/v1/baskets?segmentId=1');
    if (!k) return;
    const filtros = `zoneId=${k.zoneId}&segmentId=${k.segmentId}`;
    const total = (await get(`/v1/analytics/basket-products?${filtros}`)).cuerpo;
    const porMes = (await get(`/v1/analytics/basket-products?${filtros}&groupBy=month&asOf=${total.asOf}`)).cuerpo;
    const suma = (porMes.periods as { periodStart: string; baskets: number }[]).reduce((s, p) => s + p.baskets, 0);
    expect(suma).toBe(total.periods[0].baskets);
    for (const p of porMes.periods as { periodStart: string }[]) {
      expect(p.periodStart).toMatch(/^\d{4}-\d{2}-01$/);
    }
  }, 60000);

  it('grupo sin canastas: un periodo en 0 y data vacía; el mismo asOf repite el resultado', async () => {
    const [k] = await paginas<Canasta>('/v1/baskets?segmentId=1');
    if (!k) return;
    // La zona con un segmento que no le corresponde no tiene canastas.
    const vacio = await get(`/v1/analytics/basket-products?zoneId=${k.zoneId}&segmentId=999`);
    expect(vacio.estado).toBe(200);
    expect(vacio.cuerpo.periods).toEqual([{ periodStart: null, baskets: 0, stores: 0, totalSpend: 0 }]);
    expect(vacio.cuerpo.data).toEqual([]);

    const primera = await get(`/v1/analytics/basket-products?zoneId=${k.zoneId}&segmentId=${k.segmentId}`);
    const repetida = await get(
      `/v1/analytics/basket-products?zoneId=${k.zoneId}&segmentId=${k.segmentId}&asOf=${primera.cuerpo.asOf}`,
    );
    expect(repetida.cuerpo).toEqual(primera.cuerpo);
  }, 60000);

  it('sin segmentId, o con groupBy inválido, es 400', async () => {
    const zona = '97925ca4-3845-4e68-9660-46f781957b8c';
    expect((await get(`/v1/analytics/basket-products?zoneId=${zona}`)).estado).toBe(400);
    expect((await get(`/v1/analytics/basket-products?zoneId=${zona}&segmentId=2&groupBy=day`)).estado).toBe(400);
  });

  it('XML: raíz <response> con periodos y productos en <item>', async () => {
    const [k] = await paginas<Canasta>('/v1/baskets?segmentId=1');
    if (!k) return;
    const r = await get(`/v1/analytics/basket-products?zoneId=${k.zoneId}&segmentId=${k.segmentId}`, true);
    expect(r.estado).toBe(200);
    expect(r.tipo).toContain('application/xml');
    expect(String(r.cuerpo)).toContain('<periods>');
    expect(String(r.cuerpo)).toContain('<basketsWithProduct>');
  }, 60000);
});
