/**
 * Integración de /v1/zones y /v1/municipalities contra el servicio real
 * (Postgres + Redis). Mismos requisitos que `segments.spec.ts`:
 *
 *   docker compose up -d postgres redis catalog-service   # con el seed
 *   npm run test:integracion
 */
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { Client } from 'pg';

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

/** Conexión directa a Postgres para sembrar/limpiar lo que este servicio no expone por API. */
async function conDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'retail_user',
    password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
    database: process.env.DB_NAME ?? 'retaildb',
  });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
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
  });

  it('CAT-12: comparar exige 2+ ids distintos (400), deduplica repetidos y lista los inexistentes (404)', async () => {
    const zonas = (await http('GET', '/v1/zones?limit=100', auditor)).cuerpo.data.map((z: { id: string }) => z.id);
    const [a, b] = zonas;
    const fantasma = '00000000-0000-4000-8000-000000000000';

    expect((await http('GET', `/v1/zones/compare?ids=${a}`, auditor)).estado).toBe(400); // un solo id
    expect((await http('GET', `/v1/zones/compare?ids=${a},${a}`, auditor)).estado).toBe(400); // se reduce a uno
    const repetido = await http('GET', `/v1/zones/compare?ids=${a},${b},${a}`, auditor);
    expect(repetido.estado).toBe(200);
    expect(repetido.cuerpo).toHaveLength(2); // deduplicado

    const faltante = await http('GET', `/v1/zones/compare?ids=${a},${fantasma}`, auditor);
    expect(faltante.estado).toBe(404);
    expect(faltante.cuerpo.message).toContain(fantasma);
    expect(faltante.cuerpo.message).not.toContain(a);
  });

  it('CAT-13: el Administrador carga indicadores y clasificación, y /zones/compare los muestra', async () => {
    const adminReal = await sesion(
      await conDb(async (db) => (await db.query("SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'Administrador' LIMIT 1")).rows[0].id),
      'Administrador',
    );
    const zona = await http('POST', '/v1/zones', adminReal, { nombre: 'Zona Indicadores IT', municipioId });
    expect(zona.estado).toBe(201);
    const id = zona.cuerpo.id;
    const otra = (await http('GET', '/v1/zones?limit=100', auditor)).cuerpo.data.find((z: { id: string }) => z.id !== id).id;
    const carga = { ingresoEstimado: 18500, poblacion: 42000, disponibilidad: 0.85, periodoInicio: '2026-01-01', periodoFin: '2026-09-30', fuente: 'INEGI - Censo 2020' };

    try {
      // Antes de cargar, los indicadores son null.
      const antes = (await http('GET', `/v1/zones/compare?ids=${id},${otra}`, auditor)).cuerpo.find((f: { zoneId: string }) => f.zoneId === id);
      expect(antes).toMatchObject({ estimatedIncome: null, population: null, availability: null });

      // Solo el Administrador.
      expect((await http('PUT', `/v1/zones/${id}/indicators`, auditor, carga)).estado).toBe(403);
      expect((await http('PUT', `/v1/zones/${id}/indicators`, proveedor, carga)).estado).toBe(403);

      const r = await http('PUT', `/v1/zones/${id}/indicators`, adminReal, carga);
      expect(r.estado).toBe(200);
      expect(r.cuerpo).toMatchObject({ zoneId: id, estimatedIncome: 18500, population: 42000, availability: 0.85, source: 'INEGI - Censo 2020' });
      expect(r.cuerpo.runId).toBeTruthy();

      const despues = (await http('GET', `/v1/zones/compare?ids=${id},${otra}`, auditor)).cuerpo.find((f: { zoneId: string }) => f.zoneId === id);
      expect(despues).toMatchObject({ estimatedIncome: 18500, population: 42000, availability: 0.85 });

      // Una carga posterior del mismo periodo gana (la más reciente).
      await http('PUT', `/v1/zones/${id}/indicators`, adminReal, { ...carga, disponibilidad: 0.5 });
      const nueva = (await http('GET', `/v1/zones/compare?ids=${id},${otra}`, auditor)).cuerpo.find((f: { zoneId: string }) => f.zoneId === id);
      expect(nueva.availability).toBe(0.5);

      // Validaciones.
      for (const malo of [
        { ...carga, ingresoEstimado: -1 },
        { ...carga, poblacion: -5 },
        { ...carga, disponibilidad: 1.5 },
        { ...carga, disponibilidad: -0.1 },
        { ...carga, periodoInicio: '2026-10-01', periodoFin: '2026-01-01' },
        { ...carga, fuente: '' },
        { ...carga, extra: 1 },
      ]) {
        expect((await http('PUT', `/v1/zones/${id}/indicators`, adminReal, malo)).estado).toBe(400);
      }
      expect((await http('PUT', '/v1/zones/00000000-0000-4000-8000-000000000000/indicators', adminReal, carga)).estado).toBe(404);

      // Clasificación: cierra la vigente y crea la nueva.
      const seg = (await http('GET', '/v1/segments?limit=100', auditor)).cuerpo.data;
      expect((await http('PUT', `/v1/zones/${id}/classification`, auditor, { segmentId: seg[0].id })).estado).toBe(403);
      expect((await http('PUT', `/v1/zones/${id}/classification`, adminReal, { segmentId: 9999 })).estado).toBe(400);
      const c1 = await http('PUT', `/v1/zones/${id}/classification`, adminReal, { segmentId: seg[0].id });
      expect(c1.estado).toBe(200);
      expect(c1.cuerpo).toMatchObject({ zoneId: id, segmentId: seg[0].id, segmentCode: seg[0].code });
      expect(c1.cuerpo.previousSegmentId).toBeNull(); // sin clasificación previa (en XML se omite)
      const c2 = await http('PUT', `/v1/zones/${id}/classification`, adminReal, { segmentId: seg[1].id });
      expect(c2.cuerpo).toMatchObject({ segmentId: seg[1].id, previousSegmentId: seg[0].id });
      const vigentes = await conDb(async (db) => (await db.query('SELECT count(*)::int AS n FROM zona_clasificaciones WHERE zona_id = $1 AND vigente', [id])).rows[0].n);
      const total = await conDb(async (db) => (await db.query('SELECT count(*)::int AS n FROM zona_clasificaciones WHERE zona_id = $1', [id])).rows[0].n);
      expect(vigentes).toBe(1);
      expect(total).toBe(2); // el historial se conserva
      const fila = (await http('GET', `/v1/zones/compare?ids=${id},${otra}`, auditor)).cuerpo.find((f: { zoneId: string }) => f.zoneId === id);
      expect(fila.classification).toBe(seg[1].name);
    } finally {
      await conDb(async (db) => {
        await db.query('DELETE FROM indicador_valores WHERE zona_id = $1', [id]);
        await db.query("DELETE FROM analisis_corridas WHERE id IN (SELECT corrida_id FROM analisis_corrida_parametros WHERE clave = 'zona_id' AND valor = $1)", [id]);
        await db.query('DELETE FROM zona_clasificaciones WHERE zona_id = $1', [id]);
      });
      await http('DELETE', `/v1/zones/${id}`, adminReal);
    }
  });
});
