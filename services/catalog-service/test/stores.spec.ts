/**
 * Integración de /v1/stores contra el servicio real (Postgres + Redis).
 * Mismos requisitos que `segments.spec.ts`:
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

/** Conexión directa a Postgres para sembrar/limpiar historial (precios) que este servicio no escribe. */
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
  const esJson = !accept && texto;
  return { estado: respuesta.status, cuerpo: esJson ? JSON.parse(texto) : null, texto };
}

describe('/v1/stores (integración, requiere stack)', () => {
  let admin: string;
  let analista: string;
  let proveedor: string;
  let zonaA: string;
  let zonaB: string;
  let codigoPostal: string;
  const nombre = 'Tienda Integración';

  const alta = () => ({
    nombre,
    formato: 'minimarket',
    zonaId: zonaA,
    calle: 'Calle de prueba',
    numeroExterior: '10',
    codigoPostal,
  });

  beforeAll(async () => {
    admin = await sesion('it-s-gerente', 'Gerente de categoría');
    analista = await sesion('it-s-analista', 'Analista comercial');
    proveedor = await sesion('it-s-proveedor', 'Proveedor');
    const zonas = (await http('GET', '/v1/zones?limit=100', admin)).cuerpo.data;
    [zonaA, zonaB] = [zonas[0].id, zonas[1].id];
    codigoPostal = (await http('GET', '/v1/stores/catalog/postal-codes', admin)).cuerpo[0].codigoPostal;
  });

  afterAll(async () => {
    const lista = await http('GET', '/v1/stores?limit=100', admin);
    for (const t of lista.cuerpo?.data ?? []) {
      if (t.nombre === nombre) await http('DELETE', `/v1/stores/${t.id}`, admin);
    }
    await redis.quit();
  });

  it('el Proveedor no entra a tiendas (403)', async () => {
    expect((await http('GET', '/v1/stores', proveedor)).estado).toBe(403);
  });

  it('lista paginada por nombre, con dirección, zona y municipio anidados', async () => {
    const r = await http('GET', '/v1/stores?limit=2', analista);
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ page: 1, limit: 2 });
    const tienda = r.cuerpo.data[0];
    expect(tienda).toHaveProperty('direccion.codigoPostalRef.municipio.nombre');
    expect(tienda).toHaveProperty('zona.municipio.nombre');
    expect(tienda).toHaveProperty('proveedor');
  });

  it('el detalle y la lista devuelven la misma forma', async () => {
    const lista = (await http('GET', '/v1/stores?limit=1', analista)).cuerpo.data[0];
    const detalle = (await http('GET', `/v1/stores/${lista.id}`, analista)).cuerpo;
    expect(Object.keys(detalle).sort()).toEqual(Object.keys(lista).sort());
  });

  it('catálogo de códigos postales: arreglo plano', async () => {
    const r = await http('GET', '/v1/stores/catalog/postal-codes', analista);
    expect(r.estado).toBe(200);
    expect(Array.isArray(r.cuerpo)).toBe(true);
    expect(r.cuerpo[0]).toHaveProperty('municipio.nombre');
  });

  it('XML: la lista sale con <item> por cada tienda', async () => {
    const r = await http('GET', '/v1/stores?limit=2', analista, undefined, 'application/xml');
    expect(r.estado).toBe(200);
    expect(r.texto).toContain('<storeListResponse');
    expect((r.texto.match(/<item>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('ciclo completo: crear → editar zona y dirección → borrar', async () => {
    expect((await http('POST', '/v1/stores', analista, alta())).estado).toBe(403);

    const creada = await http('POST', '/v1/stores', admin, alta());
    expect(creada.estado).toBe(201);
    expect(creada.cuerpo).toMatchObject({
      nombre,
      activo: true,
      zonaId: zonaA,
      direccion: { calle: 'Calle de prueba', codigoPostal },
    });
    const id = creada.cuerpo.id;

    // El cambio de zona debe quedar guardado (con save() de la entidad con
    // relación eager cargada, TypeORM lo ignoraba).
    const editada = await http('PATCH', `/v1/stores/${id}`, admin, { zonaId: zonaB, calle: 'Otra calle' });
    expect(editada.estado).toBe(200);
    expect(editada.cuerpo.zonaId).toBe(zonaB);
    expect(editada.cuerpo.zona.id).toBe(zonaB);
    expect(editada.cuerpo.direccion.calle).toBe('Otra calle');

    // PATCH solo de dirección no debe fallar.
    const soloDireccion = await http('PATCH', `/v1/stores/${id}`, admin, { colonia: 'Centro' });
    expect(soloDireccion.estado).toBe(200);
    expect(soloDireccion.cuerpo.direccion.colonia).toBe('Centro');

    const desactivada = await http('PATCH', `/v1/stores/${id}`, admin, { activo: false });
    expect(desactivada.cuerpo.activo).toBe(false);

    expect((await http('DELETE', `/v1/stores/${id}`, analista)).estado).toBe(403);
    expect((await http('DELETE', `/v1/stores/${id}`, admin)).estado).toBe(204);
    expect((await http('GET', `/v1/stores/${id}`, admin)).estado).toBe(404);
  });

  it('D-07: una tienda con precios NO se borra: queda inactiva, fuera de la lista, y conserva su historial', async () => {
    const creada = await http('POST', '/v1/stores', admin, alta());
    expect(creada.estado).toBe(201);
    const id = creada.cuerpo.id;
    await conDb(async (db) => {
      const pres = (await db.query('SELECT id FROM producto_presentaciones LIMIT 1')).rows[0].id;
      await db.query(
        "INSERT INTO precios (presentacion_id, tienda_id, precio, fecha_vigencia_desde, fecha_vigencia_hasta) VALUES ($1, $2, 10, '2000-01-01', '2000-12-31')",
        [pres, id],
      );
    });

    const baja = await http('DELETE', `/v1/stores/${id}`, admin);
    expect(baja.estado).toBe(200);
    expect(baja.cuerpo).toMatchObject({ id, activo: false });

    const filas = await conDb(async (db) => (await db.query('SELECT count(*)::int AS n FROM precios WHERE tienda_id = $1', [id])).rows[0].n);
    expect(filas).toBe(1);
    const lista = await http('GET', '/v1/stores?limit=100', admin);
    expect(lista.cuerpo.data.map((t: { id: string }) => t.id)).not.toContain(id);

    // Limpieza: sin historial ya se puede borrar de verdad.
    await conDb((db) => db.query('DELETE FROM precios WHERE tienda_id = $1', [id]));
    expect((await http('DELETE', `/v1/stores/${id}`, admin)).estado).toBe(204);
  });

  it('valida zona y código postal inexistentes (400) y campos extra (400)', async () => {
    const zonaMala = await http('POST', '/v1/stores', admin, {
      ...alta(),
      zonaId: '00000000-0000-4000-8000-000000000000',
    });
    expect(zonaMala.estado).toBe(400);

    const cpMalo = await http('POST', '/v1/stores', admin, { ...alta(), codigoPostal: '00000' });
    expect(cpMalo.estado).toBe(400);

    const extra = await http('POST', '/v1/stores', admin, { ...alta(), foo: 1 });
    expect(extra.estado).toBe(400);
  });

  it('un id que no es UUID responde 400 y uno inexistente 404', async () => {
    expect((await http('GET', '/v1/stores/abc', admin)).estado).toBe(400);
    expect((await http('GET', '/v1/stores/00000000-0000-4000-8000-000000000000', admin)).estado).toBe(404);
  });
});
