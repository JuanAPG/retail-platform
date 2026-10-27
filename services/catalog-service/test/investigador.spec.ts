/**
 * D-28: el `Investigador de mercado` (app móvil) contra el servicio real.
 *
 *   docker compose up -d postgres redis catalog-service   # con el seed
 *   npm run test:integracion
 *
 * A diferencia de las otras pruebas de este directorio, el usuario NO se
 * inventa: se lee `investigador@retail.mx` del seed y se firma el token con
 * el nombre de rol que trae la base. Así, si el seed se escribe con un acento
 * distinto o el rol no se sembró, esto truena aquí y no en la demo.
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

/** Token del usuario tal como está sembrado (id y nombre de rol reales). */
async function sesionDelSeed(email: string) {
  const fila = await conDb(async (db) =>
    (
      await db.query<{ id: string; rol: string }>(
        'SELECT u.id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.email = $1',
        [email],
      )
    ).rows[0],
  );
  if (!fila) throw new Error(`El seed no tiene ${email}: ¿se recargó la base con data_retail.sql?`);
  await redis.set(`session:${fila.id}`, '1', 'EX', 600);
  const token = sign({ sub: fila.id, email, rol: fila.rol, rolId: 1, jti: `jti-${fila.id}` }, SECRET, {
    expiresIn: '10m',
  });
  return { token, rol: fila.rol, id: fila.id };
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

describe('Investigador de mercado en catalog-service (integración, requiere stack)', () => {
  let investigador: string;
  let admin: string;
  let productoId: string;
  let tiendaId: string;
  let zonaId: string;

  beforeAll(async () => {
    const sesion = await sesionDelSeed('investigador@retail.mx');
    investigador = sesion.token;
    // El nombre exacto importa: los guards comparan contra la constante ROL.
    expect(sesion.rol).toBe('Investigador de mercado');

    const sesionAdmin = await sesionDelSeed('admin@retail.mx');
    admin = sesionAdmin.token;
    zonaId = (await http('GET', '/v1/zones?limit=1', admin)).cuerpo.data[0].id;
    tiendaId = (await http('GET', '/v1/stores?limit=1', admin)).cuerpo.data[0].id;
    productoId = (await http('GET', '/v1/products?limit=1', admin)).cuerpo.data[0].id;
  });

  afterAll(async () => {
    await redis.quit();
  });

  describe('lo que D-28 le abre: 200', () => {
    it('lee el catálogo de productos y el detalle de uno', async () => {
      expect((await http('GET', '/v1/products?limit=5', investigador)).estado).toBe(200);
      expect((await http('GET', `/v1/products/${productoId}`, investigador)).estado).toBe(200);
    });

    it('lee las presentaciones de un producto', async () => {
      expect((await http('GET', `/v1/products/${productoId}/presentations`, investigador)).estado).toBe(200);
    });

    it('lee tiendas y el detalle de una', async () => {
      expect((await http('GET', '/v1/stores?limit=5', investigador)).estado).toBe(200);
      expect((await http('GET', `/v1/stores/${tiendaId}`, investigador)).estado).toBe(200);
    });

    it('lee zonas y el detalle de una', async () => {
      expect((await http('GET', '/v1/zones?limit=5', investigador)).estado).toBe(200);
      expect((await http('GET', `/v1/zones/${zonaId}`, investigador)).estado).toBe(200);
    });
  });

  describe('lo que D-28 NO le da: 403', () => {
    it('no escribe en el catálogo', async () => {
      const alta = { nombre: 'Producto del investigador', sku: 'INV-001', categoriaId: 1 };
      expect((await http('POST', '/v1/products', investigador, alta)).estado).toBe(403);
      expect((await http('PATCH', `/v1/products/${productoId}`, investigador, { nombre: 'x' })).estado).toBe(403);
      expect((await http('DELETE', `/v1/products/${productoId}`, investigador)).estado).toBe(403);
    });

    it('no escribe tiendas ni zonas', async () => {
      expect((await http('POST', '/v1/stores', investigador, { nombre: 'x' })).estado).toBe(403);
      expect((await http('POST', '/v1/zones', investigador, { nombre: 'x' })).estado).toBe(403);
    });

    it('no propone productos: D-32 (origen campo) todavía no existe', async () => {
      expect((await http('POST', '/v1/products/proposals', investigador, { nombre: 'x' })).estado).toBe(403);
    });

    it('no ve los productos pendientes (D-08: solo Gerente, Admin y Auditor)', async () => {
      expect((await http('GET', '/v1/products/pending', investigador)).estado).toBe(403);
    });
  });

  it('sin sesión en Redis no entra, aunque el token esté bien firmado', async () => {
    const { id } = await sesionDelSeed('investigador@retail.mx');
    await redis.del(`session:${id}`);
    const sinSesion = sign(
      { sub: id, email: 'investigador@retail.mx', rol: 'Investigador de mercado', rolId: 1, jti: `jti-${id}` },
      SECRET,
      { expiresIn: '10m' },
    );
    expect((await http('GET', '/v1/stores', sinSesion)).estado).toBe(401);
  });
});
