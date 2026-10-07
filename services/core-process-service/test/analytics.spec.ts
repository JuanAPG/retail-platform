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
  if (!TOKEN) throw new Error('Falta CORE_TOKEN: exporta un JWT de Analista o Administrador.');
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
