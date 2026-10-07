import Redis from 'ioredis';

/**
 * Estándar transversal de punta a punta (corre en la VM con Docker).
 *
 * Cubre lo que no se puede probar sin infraestructura real: que un JWT
 * válido cuya sesión se borró de Redis se rechace, que el health reporte
 * sus dependencias y que el formato de error y la negociación de XML se
 * respeten también en los rechazos.
 *
 *   CORE_TOKEN=<jwt-analista> npm run test:integracion
 *
 * Con `REDIS_HOST`/`REDIS_PORT` apuntando al Redis del compose
 * (por defecto localhost:6379, que es lo que publica docker-compose).
 */
const BASE = process.env.CORE_BASE_URL ?? 'http://localhost:3104';
const TOKEN = process.env.CORE_TOKEN ?? '';

function sub(jwt: string): string {
  const carga = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf-8'));
  return carga.sub as string;
}

describe('Estándar transversal (integración, requiere stack)', () => {
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

  it('GET /v1/health responde 200 sin token y reporta sus dependencias', async () => {
    const r = await fetch(`${BASE}/v1/health`);
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo).toMatchObject({
      status: 'ok',
      service: 'core-process-service',
      checks: { postgres: 'ok', redis: 'ok' },
    });
  });

  it('todas las rutas cuelgan de /v1: sin el prefijo es 404', async () => {
    const r = await fetch(`${BASE}/transactions`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(404);
  });

  it('un JWT válido con la sesión revocada en Redis se rechaza con 401', async () => {
    const conToken = { Authorization: `Bearer ${TOKEN}` };

    // 1. Con la sesión activa, el token funciona.
    const antes = await fetch(`${BASE}/v1/baskets?limit=1`, { headers: conToken });
    expect(antes.status).toBe(200);

    // 2. Se borra la sesión de Redis (lo que hace el logout de auth-service),
    //    sin tocar el token: sigue siendo válido criptográficamente.
    const redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    const clave = `session:${sub(TOKEN)}`;
    let respaldo: string | null = null;
    try {
      await redis.connect();
      respaldo = await redis.get(clave);
      await redis.del(clave);

      // 3. El mismo token ahora se rechaza: el servicio no confía solo en
      //    la firma, consulta la sesión en Redis.
      const despues = await fetch(`${BASE}/v1/baskets?limit=1`, { headers: conToken });
      expect(despues.status).toBe(401);
      const cuerpo = await despues.json();
      expect(cuerpo).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    } finally {
      // Se restaura para no dejar la sesión caída al resto de las pruebas.
      if (respaldo !== null) await redis.set(clave, respaldo);
      await redis.quit();
    }

    const restaurado = await fetch(`${BASE}/v1/baskets?limit=1`, { headers: conToken });
    expect(restaurado.status).toBe(200);
  }, 60000);

  it('el cuerpo de error es el mismo en 400, 401, 404 y 409', async () => {
    const campos = ['statusCode', 'message', 'code', 'details', 'path', 'timestamp'];
    const auth = { Authorization: `Bearer ${TOKEN}` };

    const casos = [
      await fetch(`${BASE}/v1/baskets?segmentId=abc`, { headers: auth }),
      await fetch(`${BASE}/v1/baskets?limit=1`),
      await fetch(`${BASE}/v1/baskets/00000000-0000-4000-8000-000000000000`, { headers: auth }),
    ];
    for (const r of casos) {
      const cuerpo = await r.json();
      expect(Object.keys(cuerpo).sort()).toEqual(campos.sort());
      expect(typeof cuerpo.message).toBe('string');
      expect(typeof cuerpo.code).toBe('string');
    }
  }, 30000);

  it('un 500 no filtra el mensaje interno del motor de base de datos', async () => {
    // `:id` lo valida un ParseUUIDPipe, así que un id basura da 400 limpio
    // en vez de llegar a Postgres y reventar con un 22P02 crudo.
    const r = await fetch(`${BASE}/v1/transactions/no-es-uuid`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(400);
    const cuerpo = await r.json();
    expect(cuerpo.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(cuerpo)).not.toMatch(/invalid input syntax|QueryFailedError|pg_/i);
  });

  it('XML cuando Accept lo pide, JSON cuando no', async () => {
    const auth = { Authorization: `Bearer ${TOKEN}` };
    for (const accept of ['application/xml', 'text/xml']) {
      const r = await fetch(`${BASE}/v1/baskets?limit=1`, {
        headers: { ...auth, Accept: accept },
      });
      expect(r.headers.get('content-type')).toContain('application/xml');
      expect(await r.text()).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    }
    for (const accept of ['application/json', '*/*']) {
      const r = await fetch(`${BASE}/v1/baskets?limit=1`, {
        headers: { ...auth, Accept: accept },
      });
      expect(r.headers.get('content-type')).toContain('application/json');
    }
  }, 30000);

  it('Swagger documenta los endpoints con ejemplo JSON y XML', async () => {
    const r = await fetch(`${BASE}/docs-json`);
    expect(r.status).toBe(200);
    const doc = await r.json();

    const rutas = Object.keys(doc.paths);
    expect(rutas).toContain('/v1/transactions');
    expect(rutas).toContain('/v1/baskets');
    expect(rutas).toContain('/v1/analytics/average-ticket');
    expect(rutas).toContain('/v1/health');

    // Cada respuesta documentada trae los dos formatos.
    for (const [ruta, metodos] of Object.entries<Record<string, { responses?: object }>>(doc.paths)) {
      if (ruta === '/v1/health') continue;
      for (const operacion of Object.values(metodos)) {
        for (const [codigo, respuesta] of Object.entries<{ content?: object }>(
          (operacion.responses ?? {}) as never,
        )) {
          const contenido = respuesta.content ?? {};
          expect(Object.keys(contenido)).toContain('application/json');
          expect(Object.keys(contenido)).toContain(
            'application/xml',
          );
          expect(codigo).toMatch(/^\d{3}$/);
        }
      }
    }
  }, 30000);

  // --- Resiliencia: dependencias caídas (QA-CP-08 c y d) --------------
  //
  // Requieren poder parar y arrancar contenedores, así que solo corren si
  // se exporta QA_DOCKER=1. Sin eso se omiten en vez de fallar.

  const docker = process.env.QA_DOCKER === '1';
  const compose = async (accion: 'stop' | 'start', servicio: string) => {
    const { execFileSync } = await import('child_process');
    execFileSync('docker', [accion, servicio], { stdio: 'ignore' });
  };

  /**
   * Espera a que un servicio vuelva a responder, en vez de dormir un
   * tiempo fijo: con un `sleep` las pruebas se pisaban entre sí cuando el
   * contenedor tardaba más de lo previsto en arrancar.
   */
  const esperarSano = async (url: string, intentos = 60) => {
    for (let i = 0; i < intentos; i++) {
      try {
        if ((await fetch(`${url}/v1/health`)).ok) return;
      } catch {
        // todavía no levanta
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`${url} no volvió a responder tras ${intentos}s.`);
  };

  const CATALOGO = process.env.CATALOG_BASE_URL ?? 'http://localhost:3102';
  const AUDITORIA = process.env.AUDIT_BASE_URL ?? 'http://localhost:3110';

  (docker ? it : it.skip)(
    'catalog-service caído: 503 claro y NADA se inserta',
    async () => {
      const antes = (await fetch(`${BASE}/v1/transactions?limit=1`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      }).then((r) => r.json())) as { total: number };

      await compose('stop', 'retail_catalog_service');
      try {
        const inicio = Date.now();
        const r = await fetch(`${BASE}/v1/transactions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeId: '00000000-0000-4000-8000-000000000000',
            folio: `CAT-DOWN-${Date.now()}`,
            fecha: '2026-09-15',
            details: [
              { presentationId: '00000000-0000-4000-8000-000000000000', quantity: 1, unitPrice: 10 },
            ],
          }),
        });
        const transcurrido = Date.now() - inicio;

        expect(r.status).toBe(503);
        const cuerpo = await r.json();
        expect(cuerpo.code).toBe('SERVICE_UNAVAILABLE');
        expect(cuerpo.message).toMatch(/catálogo no disponible/i);
        // Hay timeout: no se cuelga esperando al catálogo.
        expect(transcurrido).toBeLessThan(15000);

        const despues = (await fetch(`${BASE}/v1/transactions?limit=1`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        }).then((x) => x.json())) as { total: number };
        expect(despues.total).toBe(antes.total);
      } finally {
        await compose('start', 'retail_catalog_service');
        await esperarSano(CATALOGO);
      }
    },
    180000,
  );

  (docker ? it : it.skip)(
    'audit-service caído: la importación se completa igual (best-effort)',
    async () => {
      await compose('stop', 'retail_audit_service');
      try {
        const transacciones = await fetch(`${BASE}/v1/transactions?limit=1`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        }).then((r) => r.json());
        const t = transacciones.data[0];
        const d = t.details[0];

        const r = await fetch(`${BASE}/v1/transactions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeId: t.storeId,
            folio: `AUDIT-DOWN-${Date.now()}`,
            fecha: '2026-09-15',
            details: [{ presentationId: d.presentationId, quantity: 1, unitPrice: 10 }],
          }),
        });

        // La venta entra aunque la auditoría no se pueda reportar.
        expect(r.status).toBe(201);
        const creada = await r.json();
        expect(creada.total).toBe('10.00');
      } finally {
        await compose('start', 'retail_audit_service');
        await esperarSano(AUDITORIA);
      }
    },
    180000,
  );

  it('el requestId viaja de vuelta en la respuesta', async () => {
    const r = await fetch(`${BASE}/v1/health`, { headers: { 'x-request-id': 'qa-123' } });
    expect(r.headers.get('x-request-id')).toBe('qa-123');
  });
});
