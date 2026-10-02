/**
 * Integración de la caché en Redis de los catálogos planos (categorías, unidades,
 * municipios y códigos postales) contra el servicio real. Mismos requisitos que
 * `segments.spec.ts`:
 *
 *   docker compose up -d postgres redis catalog-service   # con el seed
 *   npm run test:integracion
 *
 * Para demostrar que una respuesta SALE de Redis (y no de la base) se escribe un valor
 * marcado en la llave y se comprueba que la API lo devuelve. Al terminar se borran las
 * cuatro llaves: nada marcado se queda en Redis para el siguiente que use el servicio.
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

async function http(ruta: string, token?: string, accept?: string) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(accept ? { Accept: accept } : {}) },
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, cuerpo: !accept && texto ? JSON.parse(texto) : null, texto };
}

/** Los cuatro catálogos planos y la llave de Redis de cada uno. */
const CATALOGOS = [
  { ruta: '/v1/product-categories', llave: 'catalog:categories', abiertoAlProveedor: true },
  { ruta: '/v1/units', llave: 'catalog:units', abiertoAlProveedor: true },
  { ruta: '/v1/municipalities', llave: 'catalog:municipalities', abiertoAlProveedor: false },
  { ruta: '/v1/stores/catalog/postal-codes', llave: 'catalog:postal-codes', abiertoAlProveedor: false },
];

describe('caché de catálogos en Redis (integración, requiere stack)', () => {
  let auditor: string;
  let proveedor: string;

  const limpiar = () => Promise.all(CATALOGOS.map((c) => redis.del(c.llave)));

  beforeAll(async () => {
    auditor = await sesion('it-c-auditor', 'Auditor');
    proveedor = await sesion('it-c-proveedor', 'Proveedor');
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await redis.quit();
  });

  describe.each(CATALOGOS)('$ruta → $llave', ({ ruta, llave }) => {
    it('el primer GET (MISS) llena Redis con TTL de 1 hora como máximo y el segundo sale igual', async () => {
      await redis.del(llave);
      const primera = await http(ruta, auditor);
      expect(primera.estado).toBe(200);
      expect(Array.isArray(primera.cuerpo)).toBe(true);
      expect(primera.cuerpo.length).toBeGreaterThan(0);

      expect(await redis.exists(llave)).toBe(1);
      const ttl = await redis.ttl(llave);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(3600);
      expect(JSON.parse((await redis.get(llave)) as string)).toEqual(primera.cuerpo);

      const segunda = await http(ruta, auditor);
      expect(segunda.cuerpo).toEqual(primera.cuerpo);
    });

    it('un HIT sale de Redis, no de la base (en JSON y en XML)', async () => {
      await redis.set(llave, JSON.stringify([{ marcador: 'desde-redis' }]), 'EX', 60);

      const json = await http(ruta, auditor);
      expect(json.cuerpo).toEqual([{ marcador: 'desde-redis' }]);

      const xml = await http(ruta, auditor, 'application/xml');
      expect(xml.texto).toContain('<marcador>desde-redis</marcador>');
      expect(xml.texto).toContain('<item>');

      await redis.del(llave);
    });

    it('si la llave no existe (o se borró), responde desde la base y la vuelve a llenar', async () => {
      await redis.del(llave);

      const r = await http(ruta, auditor);
      expect(r.estado).toBe(200);
      expect(r.cuerpo[0]).not.toHaveProperty('marcador');
      expect(await redis.exists(llave)).toBe(1);
    });

    it('un valor corrupto en Redis no tumba el servicio: se ignora y se recarga', async () => {
      await redis.set(llave, '{esto no es json', 'EX', 60);

      const r = await http(ruta, auditor);
      expect(r.estado).toBe(200);
      expect(Array.isArray(r.cuerpo)).toBe(true);
      expect(r.cuerpo[0]).not.toHaveProperty('marcador');
    });
  });

  it('la caché NO se salta la autenticación ni los roles', async () => {
    for (const { ruta, llave, abiertoAlProveedor } of CATALOGOS) {
      await http(ruta, auditor); // deja la llave cacheada
      expect(await redis.exists(llave)).toBe(1);

      expect((await http(ruta)).estado).toBe(401); // sin token
      // Con la llave llena, el rol sigue mandando: el Proveedor solo entra a lo abierto.
      expect((await http(ruta, proveedor)).estado).toBe(abiertoAlProveedor ? 200 : 403);
    }
  });

  it('solo se cachean los cuatro catálogos planos: lo mutable (zonas, tiendas, productos, segmentos) no deja llaves', async () => {
    await limpiar();
    const mutables = [
      '/v1/zones',
      '/v1/stores',
      '/v1/products',
      '/v1/products/pending',
      '/v1/segments',
      '/v1/providers',
    ];
    for (const ruta of mutables) await http(ruta, await sesion('it-c-admin', 'Administrador'));

    expect(await redis.keys('catalog:*')).toEqual([]);

    // Y los cuatro catálogos, una vez pedidos, dejan exactamente sus cuatro llaves.
    for (const { ruta } of CATALOGOS) await http(ruta, auditor);
    expect((await redis.keys('catalog:*')).sort()).toEqual(CATALOGOS.map((c) => c.llave).sort());
  });
});
