/**
 * Integración M09 (corre en la VM con Docker).
 *
 * Requiere: `docker compose up -d postgres redis core-process-service` con
 * seed + CSV de 100 canastas confirmadas, y token de Analista de
 * auth-service. No corre en CI sin infraestructura; se ejecuta a mano:
 *
 *   npm run test:integracion
 */
const BASE = process.env.CORE_BASE_URL ?? 'http://localhost:3104';
const TOKEN = process.env.CORE_TOKEN ?? '';

async function get(ruta: string) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

describe('M09 de punta a punta (integración, requiere stack)', () => {
  it('los 5 endpoints responden 200 con números', async () => {
    for (const ruta of [
      '/v1/analytics/average-ticket',
      '/v1/analytics/products-per-basket',
      '/v1/analytics/purchase-frequency',
      '/v1/analytics/units-per-transaction',
    ]) {
      const r = await get(ruta);
      expect(r.estado).toBe(200);
      expect(typeof r.cuerpo).toBe('number');
    }
    const gasto = await get('/v1/analytics/spend-by-category');
    expect(gasto.estado).toBe(200);
    expect(Array.isArray(gasto.cuerpo)).toBe(true);
    expect(gasto.cuerpo.length).toBeGreaterThan(0);
  });

  it('sin token es 401', async () => {
    const respuesta = await fetch(`${BASE}/v1/analytics/average-ticket`);
    expect(respuesta.status).toBe(401);
  });
});
