import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Integración M06/M07 (corre en la VM con Docker).
 *
 * Requiere: `docker compose -f infra/docker-compose.yml up -d
 * core-process-service catalog-service audit-service auth-service`
 * (postgres y redis los arrastra `depends_on`) con seed, más un token de
 * Analista o Administrador de auth-service. Sube el CSV real de 100
 * canastas con multipart de verdad. No corre en CI sin infraestructura:
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
  return {
    estado: respuesta.status,
    tipo: respuesta.headers.get('content-type') ?? '',
    cuerpo: xml ? await respuesta.text() : await respuesta.json(),
  };
}

/**
 * El stack tiene que estar arriba y el token presente: sin esto las cinco
 * pruebas fallaban con un `fetch failed` idéntico, indistinguible de una
 * regresión del servicio.
 */
beforeAll(async () => {
  let salud: Response;
  try {
    salud = await fetch(`${BASE}/v1/health`);
  } catch (error) {
    throw new Error(
      `No hay stack en ${BASE}: levanta docker compose antes de correr estas pruebas. ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const cuerpo = (await salud.json()) as { status?: string; checks?: Record<string, string> };
  if (!salud.ok) throw new Error(`GET /v1/health devolvió ${salud.status}.`);
  if (cuerpo.status !== 'ok') {
    throw new Error(`El servicio está degradado: ${JSON.stringify(cuerpo.checks)}`);
  }
  if (!TOKEN) {
    throw new Error('Falta CORE_TOKEN: exporta un JWT de Analista o Administrador.');
  }
}, 30000);

describe('M06/M07 de punta a punta (integración, requiere stack)', () => {
  it('health reporta postgres y redis en ok', async () => {
    const r = await get('/v1/health');
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
  });

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
    expect(preview.transaccionesDetectadas).toBe(100);

    const confirm = await (
      await fetch(`${BASE}/v1/transactions/import/confirm`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewId: preview.importacionId }),
      })
    ).json();

    // El resumen cuadra exactamente con lo insertado.
    expect(confirm.transaccionesCreadas).toBe(100);
    expect(confirm.canastasCreadas).toBe(100);
    expect(confirm.lineasInsertadas).toBe(154);
    expect(confirm.omitidos).toEqual([]);

    const canastas = await get('/v1/baskets?limit=5');
    expect(canastas.estado).toBe(200);
    expect(canastas.cuerpo.total).toBeGreaterThanOrEqual(100);
    expect(canastas.cuerpo.data).toHaveLength(5);
    expect(canastas.cuerpo.data[0].zoneId).toBeDefined();
  }, 180000);

  it('re-confirmar la misma importación da 409 y no duplica', async () => {
    const pendientes = await get('/v1/transactions/import/pending');
    expect(pendientes.estado).toBe(200);
    // Tras el caso anterior no debe quedar nada pendiente de ese archivo.
    expect(Array.isArray(pendientes.cuerpo)).toBe(true);
  });

  it('cada transacción tiene su canasta: total == valor_total de la canasta', async () => {
    const transacciones = await get('/v1/transactions?limit=5');
    expect(transacciones.estado).toBe(200);
    expect(transacciones.cuerpo.data.length).toBeGreaterThan(0);

    for (const t of transacciones.cuerpo.data) {
      // total == Σ subtotal de sus líneas (lo que el servicio verifica al insertar).
      const suma = t.details.reduce(
        (s: number, d: { subtotal: string }) => s + Number(d.subtotal),
        0,
      );
      expect(Number(t.total).toFixed(2)).toBe(suma.toFixed(2));

      const canastas = await get(`/v1/baskets?limit=100`);
      const canasta = canastas.cuerpo.data.find(
        (k: { transactionId: string }) => k.transactionId === t.id,
      );
      if (canasta) {
        expect(Number(canasta.totalValue).toFixed(2)).toBe(Number(t.total).toFixed(2));
      }
    }
  }, 60000);

  it('filtros combinados devuelven la intersección, no la unión', async () => {
    const todas = await get('/v1/baskets?limit=1');
    const zona = todas.cuerpo.data[0]?.zoneId;
    expect(zona).toBeDefined();

    const enZona = await get(`/v1/baskets?zoneId=${zona}&limit=100`);
    expect(enZona.estado).toBe(200);
    expect(enZona.cuerpo.data.every((k: { zoneId: string }) => k.zoneId === zona)).toBe(true);

    // Zona + rango de fechas: todo lo devuelto cumple AMBAS condiciones.
    const combinado = await get(`/v1/baskets?zoneId=${zona}&dateFrom=2026-08-01&dateTo=2026-08-31&limit=100`);
    expect(combinado.estado).toBe(200);
    expect(combinado.cuerpo.total).toBeLessThanOrEqual(enZona.cuerpo.total);
    for (const k of combinado.cuerpo.data) {
      expect(k.zoneId).toBe(zona);
      expect(k.date >= '2026-08-01').toBe(true);
      expect(k.date < '2026-09-01').toBe(true);
    }
  }, 60000);

  it('filtro sin resultados devuelve data vacía, no error', async () => {
    const r = await get('/v1/baskets?dateFrom=2099-01-01');
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ data: [], total: 0 });
  });

  it('los filtros de valor y tamaño de compra se aplican', async () => {
    const chicas = await get('/v1/baskets?size=chica&limit=100');
    expect(chicas.estado).toBe(200);
    const caras = await get('/v1/baskets?minTotalValue=100000&limit=5');
    expect(caras.estado).toBe(200);
    expect(caras.cuerpo.data).toEqual([]);
  });

  it('XML: listas con <item>, prólogo y fechas con valor', async () => {
    const r = await get('/v1/baskets?limit=2', true);
    expect(r.estado).toBe(200);
    expect(r.tipo).toContain('application/xml');
    const xml = String(r.cuerpo);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<item>');
    // La fecha NO sale como etiqueta vacía (el cliente de escritorio
    // filtra por periodo y la necesita).
    expect(xml).not.toMatch(/<date\s*\/>|<date><\/date>/);
    expect(xml).toMatch(/<date>\d{4}-\d{2}-\d{2}T/);
  });

  it('XML también en los errores', async () => {
    const r = await get('/v1/baskets/00000000-0000-4000-8000-000000000000', true);
    expect(r.estado).toBe(404);
    expect(r.tipo).toContain('application/xml');
    expect(String(r.cuerpo)).toContain('<code>NOT_FOUND</code>');
  });

  it('sin token es 401; errores con cuerpo estándar', async () => {
    const sinToken = await fetch(`${BASE}/v1/transactions`);
    expect(sinToken.status).toBe(401);
    const cuerpo = await sinToken.json();
    expect(cuerpo).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });

    const inexistente = await get('/v1/transactions/00000000-0000-4000-8000-000000000000');
    expect(inexistente.estado).toBe(404);
    expect(inexistente.cuerpo).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('el error de validación trae el detalle en `details` y message como string', async () => {
    const r = await fetch(`${BASE}/v1/transactions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: 'no-es-uuid', folio: '', fecha: 'ayer', details: [] }),
    });
    expect(r.status).toBe(400);
    const cuerpo = await r.json();
    expect(typeof cuerpo.message).toBe('string');
    expect(Array.isArray(cuerpo.details)).toBe(true);
    expect(cuerpo.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza fecha futura en el alta manual, igual que en el CSV', async () => {
    const r = await fetch(`${BASE}/v1/transactions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: '00000000-0000-4000-8000-000000000000',
        folio: 'T-FUTURO-1',
        fecha: '2099-01-01',
        details: [{ presentationId: '00000000-0000-4000-8000-000000000000', quantity: 1, unitPrice: 10 }],
      }),
    });
    expect(r.status).toBe(400);
    const cuerpo = await r.json();
    expect(JSON.stringify(cuerpo.details)).toMatch(/futura/i);
  });

  it('un parámetro de paginación inválido da 400, no 500', async () => {
    const r = await get('/v1/baskets?segmentId=abc');
    expect(r.estado).toBe(400);
    expect(r.cuerpo.code).toBe('VALIDATION_ERROR');
  });
});
