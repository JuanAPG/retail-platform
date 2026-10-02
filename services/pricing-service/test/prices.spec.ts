/**
 * Integración de /v1/prices contra el servicio real (Postgres + Redis).
 *
 *   docker compose up -d postgres redis pricing-service   # con el seed
 *   npm run test:integracion
 *
 * El registro de un precio cierra el vigente de su pareja presentación+tienda,
 * así que la prueba escoge una pareja SIN precios en el seed, trabaja solo con
 * ella y al final borra lo que creó: el historial del seed no se toca.
 * `precios.creado_por` es llave foránea a `usuarios`, por eso el token del
 * Responsable de precios usa el id de un usuario real (se busca con `pg`).
 *
 * También verifica que cada alta quede en la bitácora de audit-service, que debe
 * estar arriba (`docker compose up -d audit-service`). La bitácora es append-only:
 * esos eventos se quedan, y las aserciones filtran por el id del precio creado.
 */
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { Client } from 'pg';

const BASE = process.env.PRICING_BASE_URL ?? 'http://localhost:3103';
const AUDIT_BASE = process.env.AUDIT_BASE_URL ?? 'http://localhost:3110';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';

const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
});

const db = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  user: process.env.DB_USER ?? 'retail_user',
  password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
  database: process.env.DB_NAME ?? 'retaildb',
});

async function sesion(userId: string, rol: string): Promise<string> {
  await redis.set(`session:${userId}`, '1', 'EX', 600);
  return sign({ sub: userId, email: `${userId}@test`, rol, rolId: 1, jti: `jti-${userId}` }, SECRET, {
    expiresIn: '10m',
  });
}

async function http(metodo: string, ruta: string, token?: string, cuerpo?: object, accept?: string) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(accept ? { Accept: accept } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, cuerpo: !accept && texto ? JSON.parse(texto) : null, texto };
}

type EventoAuditoria = {
  accion: string;
  usuarioId: string | null;
  tablaAfectada: string;
  cambios: { campo: string; valorPrevio: string | null; valorPosterior: string | null }[];
};

/** Eventos de la bitácora de audit-service (`GET /v1/auditoria`) para `precios`. */
async function bitacora(token: string, registroId?: string): Promise<{ total: number; data: EventoAuditoria[] }> {
  const filtro = registroId ? `&registroId=${registroId}` : '';
  const r = await fetch(`${AUDIT_BASE}/v1/auditoria?tabla=precios&limit=1${filtro}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status).toBe(200);
  return r.json();
}

describe('/v1/prices (integración, requiere stack)', () => {
  let precios: string; // Responsable de precios (usuario real)
  let admin: string;
  let auditor: string;
  let planeador: string;
  let proveedor: string;
  let presentationId: string;
  let storeId: string;
  let productId: string;
  let zoneId: string;

  const alta = (price: number, effectiveDate?: string) => ({ presentationId, storeId, price, effectiveDate });

  /** Id de un usuario real con ese rol: quien registra un precio queda en `creado_por` (FK). */
  const usuarioReal = async (rol: string): Promise<string> => {
    const { rows } = await db.query(
      'SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = $1 LIMIT 1',
      [rol],
    );
    return rows[0].id;
  };

  const limpiar = () =>
    db.query('DELETE FROM precios WHERE presentacion_id = $1 AND tienda_id = $2', [presentationId, storeId]);

  beforeAll(async () => {
    await db.connect();
    precios = await sesion(await usuarioReal('Responsable de precios'), 'Responsable de precios');
    admin = await sesion(await usuarioReal('Administrador'), 'Administrador');
    planeador = await sesion('it-pr-planeador', 'Planeador');
    auditor = await sesion('it-pr-auditor', 'Auditor');
    proveedor = await sesion('it-pr-prov', 'Proveedor');

    // Una pareja presentación+tienda sin ningún precio en el seed.
    const libre = await db.query(`
      SELECT pres.id AS presentacion_id, pres.producto_id, t.id AS tienda_id, t.zona_id
      FROM producto_presentaciones pres CROSS JOIN tiendas t
      WHERE NOT EXISTS (SELECT 1 FROM precios p WHERE p.presentacion_id = pres.id AND p.tienda_id = t.id)
      LIMIT 1`);
    ({ presentacion_id: presentationId, producto_id: productId, tienda_id: storeId, zona_id: zoneId } = libre.rows[0]);
  });

  afterAll(async () => {
    await limpiar();
    await db.end();
    await redis.quit();
  });

  it('sin token responde 401 con el error estándar', async () => {
    const r = await http('GET', `/v1/prices/history?productId=${productId}`);
    expect(r.estado).toBe(401);
    expect(r.cuerpo).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('el Proveedor no entra a ninguna ruta de precios (403)', async () => {
    expect((await http('GET', `/v1/prices/history?productId=${productId}`, proveedor)).estado).toBe(403);
    expect((await http('GET', `/v1/prices/compare-zones?productId=${productId}`, proveedor)).estado).toBe(403);
    expect((await http('POST', '/v1/prices', proveedor, alta(10))).estado).toBe(403);
  });

  it('solo Administrador y Responsable de precios registran (el Planeador lee pero no escribe)', async () => {
    expect((await http('POST', '/v1/prices', planeador, alta(10))).estado).toBe(403);
    expect((await http('GET', `/v1/prices/history?productId=${productId}`, planeador)).estado).toBe(200);
  });

  it('valida el cuerpo: faltantes, precio no positivo, ids inexistentes y campos que fija el servidor', async () => {
    expect((await http('POST', '/v1/prices', precios, {})).estado).toBe(400);
    expect((await http('POST', '/v1/prices', precios, alta(0))).estado).toBe(400);
    expect((await http('POST', '/v1/prices', precios, alta(-5))).estado).toBe(400);
    expect((await http('POST', '/v1/prices', precios, { ...alta(10), origen: 'propuesta_proveedor_aprobada' })).estado).toBe(400);
    expect((await http('POST', '/v1/prices', precios, { ...alta(10), createdBy: 'x' })).estado).toBe(400);

    const ghost = '00000000-0000-4000-8000-000000000000';
    expect((await http('POST', '/v1/prices', precios, { ...alta(10), presentationId: ghost })).estado).toBe(400);
    expect((await http('POST', '/v1/prices', precios, { ...alta(10), storeId: ghost })).estado).toBe(400);
    expect((await http('POST', '/v1/prices', precios, { ...alta(10), storeId: 'abc' })).estado).toBe(400);
  });

  it('el histórico no se sobrescribe: un precio nuevo cierra el anterior el día previo', async () => {
    const primero = await http('POST', '/v1/prices', precios, alta(40, '2026-01-10'));
    expect(primero.estado).toBe(201);
    expect(primero.cuerpo).toMatchObject({
      price: '40.00',
      effectiveDate: '2026-01-10',
      effectiveUntil: null,
      vigente: true,
      origen: 'interno',
      presentation: { id: presentationId, productoId: productId },
      store: { id: storeId, zonaId: zoneId },
    });
    expect(primero.cuerpo.createdBy).toBeTruthy();

    // Quedó en la bitácora: insert, con el actor del token y sin precio anterior.
    const eventoUno = await bitacora(auditor, primero.cuerpo.id);
    expect(eventoUno.total).toBe(1);
    expect(eventoUno.data[0]).toMatchObject({
      accion: 'insert',
      tablaAfectada: 'precios',
      usuarioId: primero.cuerpo.createdBy,
    });
    expect(eventoUno.data[0].cambios).toEqual(
      expect.arrayContaining([expect.objectContaining({ campo: 'precio', valorPosterior: '40' })]),
    );

    const segundo = await http('POST', '/v1/prices', admin, alta(42.5, '2026-02-20'));
    expect(segundo.estado).toBe(201);
    expect(segundo.cuerpo).toMatchObject({ price: '42.50', vigente: true });

    // El segundo evento conserva el precio que se cerró.
    const eventoDos = await bitacora(auditor, segundo.cuerpo.id);
    expect(eventoDos.total).toBe(1);
    expect(eventoDos.data[0].cambios).toEqual(
      expect.arrayContaining([expect.objectContaining({ campo: 'precio_anterior', valorPrevio: '40.00' })]),
    );

    const historial = await http('GET', `/v1/prices/history?productId=${productId}&presentationId=${presentationId}`, planeador);
    expect(historial.estado).toBe(200);
    expect(historial.cuerpo.total).toBe(2);
    const [nuevo, viejo] = historial.cuerpo.data;
    expect(nuevo).toMatchObject({ price: '42.50', effectiveDate: '2026-02-20', effectiveUntil: null, vigente: true });
    expect(viejo).toMatchObject({ price: '40.00', effectiveDate: '2026-01-10', effectiveUntil: '2026-02-19', vigente: false });
  });

  it('no permite registrar hacia atrás ni el mismo día del vigente (409), y no deja evento en la bitácora', async () => {
    const eventosAntes = (await bitacora(auditor)).total;

    expect((await http('POST', '/v1/prices', precios, alta(50, '2026-02-20'))).estado).toBe(409);
    expect((await http('POST', '/v1/prices', precios, alta(50, '2026-01-01'))).estado).toBe(409);

    expect((await bitacora(auditor)).total).toBe(eventosAntes);

    const historial = await http('GET', `/v1/prices/history?productId=${productId}&presentationId=${presentationId}`, precios);
    expect(historial.cuerpo.total).toBe(2); // los intentos fallidos no escribieron nada
  });

  it('dos registros simultáneos: uno gana (201) y el otro recibe 409, sin dejar dos vigentes', async () => {
    const [a, b] = await Promise.all([
      http('POST', '/v1/prices', precios, alta(44, '2026-03-05')),
      http('POST', '/v1/prices', admin, alta(45, '2026-03-05')),
    ]);
    expect([a.estado, b.estado].sort()).toEqual([201, 409]);

    const vigentes = await db.query(
      'SELECT count(*)::int AS n FROM precios WHERE presentacion_id = $1 AND tienda_id = $2 AND vigente',
      [presentationId, storeId],
    );
    expect(vigentes.rows[0].n).toBe(1);
  });

  it('historial: paginado, lo más reciente primero, y página fuera de rango vacía', async () => {
    const p1 = await http('GET', `/v1/prices/history?productId=${productId}&presentationId=${presentationId}&limit=1`, precios);
    expect(p1.cuerpo).toMatchObject({ page: 1, limit: 1, total: 3 });
    expect(p1.cuerpo.data).toHaveLength(1);
    expect(p1.cuerpo.data[0].effectiveDate).toBe('2026-03-05');

    const p3 = await http('GET', `/v1/prices/history?productId=${productId}&presentationId=${presentationId}&limit=1&page=3`, precios);
    expect(p3.cuerpo.data[0].effectiveDate).toBe('2026-01-10');

    const fuera = await http('GET', `/v1/prices/history?productId=${productId}&page=9999`, precios);
    expect(fuera.estado).toBe(200);
    expect(fuera.cuerpo.data).toEqual([]);
  });

  it('historial: valida productId (400) y producto inexistente (404)', async () => {
    expect((await http('GET', '/v1/prices/history', precios)).estado).toBe(400);
    expect((await http('GET', '/v1/prices/history?productId=abc', precios)).estado).toBe(400);
    expect((await http('GET', `/v1/prices/history?productId=${productId}&presentationId=abc`, precios)).estado).toBe(400);
    expect(
      (await http('GET', '/v1/prices/history?productId=00000000-0000-4000-8000-000000000000', precios)).estado,
    ).toBe(404);
  });

  it('historial en XML: cada precio sale como <item>', async () => {
    const r = await http('GET', `/v1/prices/history?productId=${productId}&limit=2`, precios, undefined, 'application/xml');
    expect(r.estado).toBe(200);
    expect(r.texto).toContain('<response>');
    expect(r.texto).toContain('<effectiveDate>');
    expect(r.texto.match(/<data>/g)).toHaveLength(1);
  });

  it('compare-zones: agrega el precio VIGENTE por zona', async () => {
    const r = await http('GET', `/v1/prices/compare-zones?productId=${productId}`, planeador);
    expect(r.estado).toBe(200);
    expect(r.cuerpo.productId).toBe(productId);

    const zona = r.cuerpo.zones.find((z: { zoneId: string }) => z.zoneId === zoneId);
    expect(zona).toBeDefined();
    expect(typeof zona.averagePrice).toBe('number');
    expect(zona.minPrice).toBeLessThanOrEqual(zona.maxPrice);
    expect(zona.storeCount).toBeGreaterThanOrEqual(1);

    // La zona agrega TODAS sus tiendas con precio vigente de este producto (las del
    // seed también): se compara contra el cálculo directo en SQL, que solo cuenta
    // `vigente` (nunca el histórico cerrado de 40 y 42.5).
    const esperado = await db.query(
      `SELECT min(p.precio)::float AS min, max(p.precio)::float AS max, avg(p.precio)::float AS avg,
              count(DISTINCT p.tienda_id)::int AS tiendas
       FROM precios p
       JOIN producto_presentaciones pres ON pres.id = p.presentacion_id
       JOIN tiendas t ON t.id = p.tienda_id
       WHERE pres.producto_id = $1 AND t.zona_id = $2 AND p.vigente`,
      [productId, zoneId],
    );
    const { min, max, avg, tiendas } = esperado.rows[0];
    expect(zona).toMatchObject({ minPrice: min, maxPrice: max, storeCount: tiendas });
    expect(zona.averagePrice).toBeCloseTo(avg, 6);
    // Entre el histórico (40 / 42.5) y el vigente (44 o 45), solo el vigente cuenta.
    expect(zona.maxPrice).toBeGreaterThanOrEqual(44);

    const xml = await http('GET', `/v1/prices/compare-zones?productId=${productId}`, planeador, undefined, 'application/xml');
    expect(xml.texto).toContain('<zones>');
  });

  it('compare-zones: valida productId (400) y producto inexistente (404)', async () => {
    expect((await http('GET', '/v1/prices/compare-zones', precios)).estado).toBe(400);
    expect((await http('GET', '/v1/prices/compare-zones?productId=abc', precios)).estado).toBe(400);
    expect(
      (await http('GET', '/v1/prices/compare-zones?productId=00000000-0000-4000-8000-000000000000', precios)).estado,
    ).toBe(404);
  });
});
