import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Integración M06/M07 (corre en la VM con Docker).
 *
 * Requiere: `docker compose up -d postgres redis catalog-service
 * core-process-service audit-service` con seed + token de Analista de
 * auth-service. Sube el CSV real de 100 canastas con multipart de verdad.
 * No corre en CI sin infraestructura; se ejecuta a mano:
 *
 *   CORE_TOKEN=<jwt-analista> npm run test:integracion
 */
const BASE = process.env.CORE_BASE_URL ?? 'http://localhost:3104';
const TOKEN = process.env.CORE_TOKEN ?? '';
const CSV_100 = join(__dirname, '..', '..', '..', 'db', 'datos_prueba_100_canastas.csv');

const auth = { Authorization: `Bearer ${TOKEN}` };

async function get(ruta: string, xml = false) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    headers: { ...auth, ...(xml ? { Accept: 'application/xml' } : {}) },
  });
  return { estado: respuesta.status, cuerpo: xml ? await respuesta.text() : await respuesta.json() };
}

describe('M06/M07 de punta a punta (integración, requiere stack)', () => {
  it('CSV 100: preview 154/0, confirm 100/100 y canastas visibles', async () => {
    const forma = new FormData();
    forma.append('file', new Blob([readFileSync(CSV_100)], { type: 'text/csv' }), 'datos.csv');
    const preview = await (
      await fetch(`${BASE}/v1/transactions/import/preview`, {
        method: 'POST',
        headers: auth,
        body: forma,
      })
    ).json();

    expect(preview.filasTotales).toBe(154);
    expect(preview.filasConError).toBe(0);

    const confirm = await (
      await fetch(`${BASE}/v1/transactions/import/confirm`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewId: preview.importacionId }),
      })
    ).json();
    expect(confirm.transaccionesCreadas).toBe(100);
    expect(confirm.canastasCreadas).toBe(100);

    const canastas = await get('/v1/baskets?limit=5');
    expect(canastas.estado).toBe(200);
    expect(canastas.cuerpo.total).toBeGreaterThanOrEqual(100);
    expect(canastas.cuerpo.data[0].zoneId).toBeDefined();
  }, 120000);

  it('XML de canastas trae <item> por elemento', async () => {
    const r = await get('/v1/baskets?limit=2', true);
    expect(r.estado).toBe(200);
    expect(String(r.cuerpo)).toContain('<item>');
  });

  it('sin token es 401; errores con cuerpo estándar', async () => {
    const sinToken = await fetch(`${BASE}/v1/transactions`);
    expect(sinToken.status).toBe(401);
    const inexistente = await get('/v1/transactions/00000000-0000-4000-8000-000000000000');
    expect(inexistente.estado).toBe(404);
    expect(inexistente.cuerpo).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});
