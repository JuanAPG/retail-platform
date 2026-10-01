/**
 * Integración de /v1/zones y /v1/municipalities contra el servicio real
 * (Postgres + Redis). Mismos requisitos que `segments.spec.ts`:
 *
 *   docker compose up -d postgres redis catalog-service   # con el seed
 *   npm run test:integracion
 */
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';

const BASE = process.env.CATALOG_BASE_URL ?? 'http://localhost:3102';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';

const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
});

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

describe('/v1/zones y /v1/municipalities (integración, requiere stack)', () => {
  let admin: string;
  let auditor: string;
  let proveedor: string;
  let municipioId: number;
  const nombre = 'Zona Integración';

  beforeAll(async () => {
    admin = await sesion('it-z-admin', 'Administrador');
    auditor = await sesion('it-z-auditor', 'Auditor');
    proveedor = await sesion('it-z-proveedor', 'Proveedor');
    municipioId = (await http('GET', '/v1/municipalities', auditor)).cuerpo[0].id;
  });

  afterAll(async () => {
    const lista = await http('GET', '/v1/zones?limit=100', admin);
    for (const z of lista.cuerpo?.data ?? []) {
      if (z.nombre === nombre) await http('DELETE', `/v1/zones/${z.id}`, admin);
    }
    await redis.quit();
  });

  it('el Proveedor no entra a zonas ni municipios (403)', async () => {
    expect((await http('GET', '/v1/zones', proveedor)).estado).toBe(403);
    expect((await http('GET', '/v1/municipalities', proveedor)).estado).toBe(403);
  });

  it('municipios: arreglo plano ordenado por nombre', async () => {
    const r = await http('GET', '/v1/municipalities', auditor);
    expect(r.estado).toBe(200);
    expect(Array.isArray(r.cuerpo)).toBe(true);
    const nombres = r.cuerpo.map((m: { nombre: string }) => m.nombre);
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b)));
  });

  it('zonas: lista paginada con su municipio incluido', async () => {
    const r = await http('GET', '/v1/zones?limit=2', auditor);
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ page: 1, limit: 2 });
    expect(r.cuerpo.data[0]).toHaveProperty('municipio.nombre');
  });

  it('un id que no es UUID responde 400 y uno inexistente 404', async () => {
    expect((await http('GET', '/v1/zones/abc', auditor)).estado).toBe(400);
    expect(
      (await http('GET', '/v1/zones/00000000-0000-4000-8000-000000000000', auditor)).estado,
    ).toBe(404);
  });

  it('ciclo completo: crear → duplicado → editar → borrar', async () => {
    expect((await http('POST', '/v1/zones', auditor, { nombre, municipioId })).estado).toBe(403);

    const creada = await http('POST', '/v1/zones', admin, { nombre, municipioId });
    expect(creada.estado).toBe(201);
    expect(creada.cuerpo).toMatchObject({ nombre, activo: true, municipio: { id: municipioId } });
    const id = creada.cuerpo.id;

    expect((await http('POST', '/v1/zones', admin, { nombre, municipioId })).estado).toBe(409);
    expect((await http('POST', '/v1/zones', admin, { nombre: 'X', municipioId: 9999 })).estado).toBe(400);

    const editada = await http('PATCH', `/v1/zones/${id}`, admin, { activo: false, descripcion: 'edit' });
    expect(editada.estado).toBe(200);
    expect(editada.cuerpo).toMatchObject({ activo: false, descripcion: 'edit', municipioId });

    const borrada = await http('DELETE', `/v1/zones/${id}`, admin);
    expect(borrada.estado).toBe(204);
    expect((await http('GET', `/v1/zones/${id}`, admin)).estado).toBe(404);
  });

  it('no se puede borrar una zona con tiendas (409)', async () => {
    const zonas = await http('GET', '/v1/zones?limit=100', admin);
    // Las zonas del seed tienen tiendas asociadas.
    const r = await http('DELETE', `/v1/zones/${zonas.cuerpo.data[0].id}`, admin);
    expect(r.estado).toBe(409);
  });

  it('compare: filas por zona; ids ausentes o mal formados → 400', async () => {
    const zonas = await http('GET', '/v1/zones?limit=100', auditor);
    const ids = zonas.cuerpo.data.map((z: { id: string }) => z.id).join(',');
    const r = await http('GET', `/v1/zones/compare?ids=${ids}`, auditor);
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toHaveLength(zonas.cuerpo.data.length);
    expect(r.cuerpo[0]).toHaveProperty('zoneName');

    expect((await http('GET', '/v1/zones/compare', auditor)).estado).toBe(400);
    expect((await http('GET', '/v1/zones/compare?ids=1,2', auditor)).estado).toBe(400);
    expect(
      (await http('GET', '/v1/zones/compare?ids=00000000-0000-4000-8000-000000000000', auditor)).estado,
    ).toBe(404);
  });
});
