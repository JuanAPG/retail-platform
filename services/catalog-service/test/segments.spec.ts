/**
 * Integración de /v1/segments contra el servicio real (Postgres + Redis).
 *
 * Requiere: `docker compose up -d postgres redis catalog-service` con el
 * seed cargado (3 segmentos ING_1..ING_3). No corre en CI sin
 * infraestructura; se ejecuta a mano:
 *
 *   npm run test:integracion
 *
 * No depende de auth-service: firma el JWT con JWT_ACCESS_SECRET y abre la
 * sesión directo en Redis, que es lo único que el SessionGuard verifica.
 */
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';

const BASE = process.env.CATALOG_BASE_URL ?? 'http://localhost:3102';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';

const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
});

/** Token de un usuario con sesión activa en Redis. */
async function sesion(userId: string, rol: string): Promise<string> {
  await redis.set(`session:${userId}`, '1', 'EX', 600);
  return sign({ sub: userId, email: `${userId}@test`, rol, rolId: 1, jti: `jti-${userId}` }, SECRET, {
    expiresIn: '10m',
  });
}

async function http(metodo: string, ruta: string, token?: string, cuerpo?: object) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

const nuevo = {
  code: 'ING_IT',
  name: 'Segmento integración',
  incomeRangeMin: 900000,
  source: 'prueba',
  updateFrequency: 'n/a',
  zoneRelation: 'zona agregada',
  limitations: 'solo para pruebas',
};

describe('/v1/segments (integración, requiere stack)', () => {
  let admin: string;
  let analista: string;
  let auditor: string;
  let proveedor: string;

  beforeAll(async () => {
    admin = await sesion('it-admin', 'Administrador');
    analista = await sesion('it-analista', 'Analista comercial');
    auditor = await sesion('it-auditor', 'Auditor');
    proveedor = await sesion('it-proveedor', 'Proveedor');
  });

  afterAll(async () => {
    // Limpieza por si una aserción falló a medias.
    const lista = await http('GET', '/v1/segments?limit=100', admin);
    for (const s of lista.cuerpo?.data ?? []) {
      if (s.code === nuevo.code) await http('DELETE', `/v1/segments/${s.id}`, admin);
    }
    await redis.quit();
  });

  it('sin token responde 401 con el error estándar', async () => {
    const r = await http('GET', '/v1/segments');
    expect(r.estado).toBe(401);
    expect(r.cuerpo).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', path: '/v1/segments' });
  });

  it('el Proveedor no entra a segmentos (403)', async () => {
    expect((await http('GET', '/v1/segments', proveedor)).estado).toBe(403);
  });

  it('la lista viene paginada y ordenada por ingreso mínimo', async () => {
    const r = await http('GET', '/v1/segments?limit=2', auditor);
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ page: 1, limit: 2 });
    expect(r.cuerpo.total).toBeGreaterThanOrEqual(3);
    expect(r.cuerpo.data).toHaveLength(2);
    const [a, b] = r.cuerpo.data.map((s: { incomeRangeMin: string }) => Number(s.incomeRangeMin));
    expect(a).toBeLessThanOrEqual(b);
  });

  it('una página fuera de rango devuelve data vacío, no error', async () => {
    const r = await http('GET', '/v1/segments?page=9999', auditor);
    expect(r.estado).toBe(200);
    expect(r.cuerpo.data).toEqual([]);
  });

  it('ciclo completo: crear → duplicado → editar → borrar → 404', async () => {
    const creado = await http('POST', '/v1/segments', analista, nuevo);
    expect(creado.estado).toBe(201);
    expect(creado.cuerpo).toMatchObject({ code: 'ING_IT', incomeRangeMax: null });
    const id = creado.cuerpo.id;

    expect((await http('POST', '/v1/segments', analista, nuevo)).estado).toBe(409);
    expect((await http('POST', '/v1/segments', auditor, nuevo)).estado).toBe(403);

    const editado = await http('PATCH', `/v1/segments/${id}`, analista, { incomeRangeMax: 950000 });
    expect(editado.estado).toBe(200);
    expect(Number(editado.cuerpo.incomeRangeMax)).toBe(950000);

    // Solo el Administrador borra.
    expect((await http('DELETE', `/v1/segments/${id}`, analista)).estado).toBe(403);
    const borrado = await http('DELETE', `/v1/segments/${id}`, admin);
    expect(borrado.estado).toBe(204);
    expect(borrado.cuerpo).toBeNull();

    expect((await http('GET', `/v1/segments/${id}`, admin)).estado).toBe(404);
  });

  it('rechaza campos que no están en el contrato (400)', async () => {
    const r = await http('POST', '/v1/segments', analista, { ...nuevo, foo: 1 });
    expect(r.estado).toBe(400);
    expect(r.cuerpo.code).toBe('VALIDATION_ERROR');
  });

  it('un token sin sesión en Redis ya no vale (401)', async () => {
    const token = await sesion('it-efimero', 'Administrador');
    expect((await http('GET', '/v1/segments', token)).estado).toBe(200);
    await redis.del('session:it-efimero');
    expect((await http('GET', '/v1/segments', token)).estado).toBe(401);
  });
});
