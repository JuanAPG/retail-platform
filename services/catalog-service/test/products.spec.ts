/**
 * Integración de /v1/products, /v1/presentations y catálogos de producto
 * contra el servicio real (Postgres + Redis). Mismos requisitos que
 * `segments.spec.ts`:
 *
 *   docker compose up -d postgres redis catalog-service   # con el seed
 *   npm run test:integracion
 *
 * El Proveedor de prueba usa los correos del seed (`proveedores.email`),
 * porque así se vincula una cuenta con su empresa.
 */
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';

const BASE = process.env.CATALOG_BASE_URL ?? 'http://localhost:3102';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';

const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
});

async function sesion(userId: string, rol: string, email = `${userId}@test`): Promise<string> {
  await redis.set(`session:${userId}`, '1', 'EX', 600);
  return sign({ sub: userId, email, rol, rolId: 1, jti: `jti-${userId}` }, SECRET, { expiresIn: '10m' });
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

const SKU = 'IT-PROD-001';

describe('productos y presentaciones (integración, requiere stack)', () => {
  let admin: string;
  let gerente: string;
  let auditor: string;
  let proveedor: string;
  let categoriaId: number;

  const alta = () => ({
    sku: SKU,
    nombre: 'Producto integración',
    categoriaId,
    esCanastaBasica: true,
    presentacion: '1 kg',
    contenido: 1,
    unidadMedida: 'kg',
  });

  beforeAll(async () => {
    admin = await sesion('it-p-admin', 'Administrador');
    gerente = await sesion('it-p-gerente', 'Gerente de categoría');
    auditor = await sesion('it-p-auditor', 'Auditor');
    proveedor = await sesion('it-p-prov', 'Proveedor', 'ventas@lacteosdelnorte.mx');
    categoriaId = (await http('GET', '/v1/product-categories', auditor)).cuerpo[0].id;
  });

  afterAll(async () => {
    const lista = await http('GET', '/v1/products?limit=100', admin);
    for (const p of lista.cuerpo?.data ?? []) {
      if (p.sku === SKU) await http('DELETE', `/v1/products/${p.id}`, admin);
    }
    await redis.quit();
  });

  it('catálogos: categorías y unidades planas y abiertas incluso al Proveedor', async () => {
    const categorias = await http('GET', '/v1/product-categories', proveedor);
    expect(categorias.estado).toBe(200);
    expect(Array.isArray(categorias.cuerpo)).toBe(true);

    const unidades = await http('GET', '/v1/units', proveedor);
    expect(unidades.estado).toBe(200);
    expect(unidades.cuerpo.map((u: { clave: string }) => u.clave)).toContain('kg');
  });

  it('proveedores: paginado y vedado al Proveedor y al Planeador', async () => {
    const r = await http('GET', '/v1/providers?limit=1', auditor);
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ page: 1, limit: 1 });
    expect(r.cuerpo.data).toHaveLength(1);
    expect((await http('GET', '/v1/providers', proveedor)).estado).toBe(403);
  });

  it('el catálogo completo lo ve un perfil interno; el Proveedor solo lo suyo', async () => {
    const interno = await http('GET', '/v1/products?limit=100', auditor);
    const suyo = await http('GET', '/v1/products?limit=100', proveedor);

    expect(interno.estado).toBe(200);
    expect(suyo.estado).toBe(200);
    expect(suyo.cuerpo.total).toBeGreaterThan(0);
    expect(suyo.cuerpo.total).toBeLessThan(interno.cuerpo.total);
    const proveedoresVistos = new Set(suyo.cuerpo.data.map((p: { proveedorId: string }) => p.proveedorId));
    expect(proveedoresVistos.size).toBe(1);
    expect(suyo.cuerpo.data[0]).toHaveProperty('presentaciones');
    expect(suyo.cuerpo.data[0]).toHaveProperty('categoria.nombre');
  });

  it('el Proveedor no entra al detalle ni a rutas de escritura (403)', async () => {
    const cualquiera = (await http('GET', '/v1/products?limit=1', admin)).cuerpo.data[0].id;
    expect((await http('GET', `/v1/products/${cualquiera}`, proveedor)).estado).toBe(403);
    expect((await http('POST', '/v1/products', proveedor, alta())).estado).toBe(403);
    expect((await http('POST', '/v1/products', auditor, alta())).estado).toBe(403);
  });

  it('ciclo completo: crear → editar → agregar y borrar presentación → borrar producto', async () => {
    const creado = await http('POST', '/v1/products', gerente, alta());
    expect(creado.estado).toBe(201);
    expect(creado.cuerpo).toMatchObject({ sku: SKU, estatus: 'activo', proveedorId: null, esCanastaBasica: true });
    expect(creado.cuerpo.presentaciones).toHaveLength(1);
    expect(creado.cuerpo.presentaciones[0]).toMatchObject({ esPredeterminada: true, unidadMedida: { clave: 'kg' } });
    const id = creado.cuerpo.id;

    expect((await http('POST', '/v1/products', gerente, alta())).estado).toBe(409);

    const otraCategoria = (await http('GET', '/v1/product-categories', auditor)).cuerpo.find(
      (c: { id: number }) => c.id !== categoriaId,
    );
    const editado = await http('PATCH', `/v1/products/${id}`, gerente, {
      nombre: 'Producto editado',
      categoriaId: otraCategoria.id,
    });
    expect(editado.estado).toBe(200);
    // El cambio de categoría debe quedar guardado.
    expect(editado.cuerpo).toMatchObject({ nombre: 'Producto editado', categoriaId: otraCategoria.id });
    expect(editado.cuerpo.categoria.id).toBe(otraCategoria.id);

    // 'estatus' no se edita por aquí.
    expect((await http('PATCH', `/v1/products/${id}`, gerente, { estatus: 'activo' })).estado).toBe(400);

    const medio = await http('POST', `/v1/products/${id}/presentations`, gerente, {
      nombre: '500 g',
      contenido: 500,
      unidadMedida: 'g',
    });
    expect(medio.estado).toBe(201);
    expect(medio.cuerpo).toMatchObject({ esPredeterminada: false, unidadMedida: { clave: 'g' } });

    // Una segunda predeterminada choca con el índice único.
    const segunda = await http('POST', `/v1/products/${id}/presentations`, gerente, {
      nombre: '2 kg',
      contenido: 2,
      unidadMedida: 'kg',
      esPredeterminada: true,
    });
    expect(segunda.estado).toBe(409);

    const unidadMala = await http('POST', `/v1/products/${id}/presentations`, gerente, {
      nombre: 'x',
      contenido: 1,
      unidadMedida: 'zzz',
    });
    expect(unidadMala.estado).toBe(400);

    const lista = await http('GET', `/v1/products/${id}/presentations`, auditor);
    expect(lista.estado).toBe(200);
    expect(lista.cuerpo).toHaveLength(2);

    expect((await http('DELETE', `/v1/presentations/${medio.cuerpo.id}`, auditor)).estado).toBe(403);
    expect((await http('DELETE', `/v1/presentations/${medio.cuerpo.id}`, gerente)).estado).toBe(204);
    expect((await http('DELETE', `/v1/presentations/${medio.cuerpo.id}`, gerente)).estado).toBe(404);

    expect((await http('DELETE', `/v1/products/${id}`, gerente)).estado).toBe(204);
    expect((await http('GET', `/v1/products/${id}`, admin)).estado).toBe(404);
    expect((await http('GET', `/v1/products/${id}/presentations`, admin)).estado).toBe(404);
  });

  it('valida categoría y unidad inexistentes (400) y campos extra (400)', async () => {
    expect((await http('POST', '/v1/products', admin, { ...alta(), categoriaId: 9999 })).estado).toBe(400);
    expect((await http('POST', '/v1/products', admin, { ...alta(), unidadMedida: 'zzz' })).estado).toBe(400);
    expect((await http('POST', '/v1/products', admin, { ...alta(), proveedorId: 'x' })).estado).toBe(400);
  });

  it('un id que no es UUID responde 400 y uno inexistente 404', async () => {
    expect((await http('GET', '/v1/products/abc', admin)).estado).toBe(400);
    expect((await http('GET', '/v1/products/00000000-0000-4000-8000-000000000000', admin)).estado).toBe(404);
    expect((await http('DELETE', '/v1/presentations/abc', admin)).estado).toBe(400);
  });
});
