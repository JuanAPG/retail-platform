/**
 * Integración del flujo de propuesta → bandeja → aprobar/rechazar de
 * productos (RF-12) contra el servicio real. Mismos requisitos que
 * `segments.spec.ts`.
 *
 * `producto_revisiones.revisado_por` es llave foránea a `usuarios`, así que
 * el revisor de la prueba debe ser un usuario real del seed: se busca con
 * `pg`. El Proveedor usa el correo de una empresa del seed.
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

/** Id de un usuario real con el rol dado (para satisfacer la FK de revisiones). */
async function usuarioReal(rol: string): Promise<string> {
  const db = new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'retail_user',
    password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
    database: process.env.DB_NAME ?? 'retaildb',
  });
  await db.connect();
  try {
    const { rows } = await db.query(
      'SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = $1 LIMIT 1',
      [rol],
    );
    return rows[0].id;
  } finally {
    await db.end();
  }
}

const SKUS = ['IT-PROP-001', 'IT-PROP-002'];

describe('propuesta y revisión de productos (integración, requiere stack)', () => {
  let gerente: string;
  let admin: string;
  let auditor: string;
  let proveedor: string;
  let categoriaId: number;

  const propuesta = (sku: string) => ({
    sku,
    nombre: `Propuesta ${sku}`,
    categoriaId,
    presentacion: '400 g',
    contenido: 400,
    unidadMedida: 'g',
  });

  beforeAll(async () => {
    gerente = await sesion(await usuarioReal('Gerente de categoría'), 'Gerente de categoría');
    admin = await sesion('it-a-admin', 'Administrador');
    auditor = await sesion('it-a-auditor', 'Auditor');
    proveedor = await sesion('it-a-prov', 'Proveedor', 'ventas@lacteosdelnorte.mx');
    categoriaId = (await http('GET', '/v1/product-categories', auditor)).cuerpo[0].id;
  });

  afterAll(async () => {
    const lista = await http('GET', '/v1/products?limit=100', admin);
    for (const p of lista.cuerpo?.data ?? []) {
      if (SKUS.includes(p.sku)) await http('DELETE', `/v1/products/${p.id}`, admin);
    }
    await redis.quit();
  });

  it('la propuesta nace pendiente, ligada a la empresa del token, y el servidor fija lo que el proveedor no decide', async () => {
    const r = await http('POST', '/v1/products/proposals', proveedor, propuesta(SKUS[0]));
    expect(r.estado).toBe(201);
    expect(r.cuerpo).toMatchObject({
      sku: SKUS[0],
      estatus: 'pendiente_aprobacion',
      esCanastaBasica: false,
      proveedor: { email: 'ventas@lacteosdelnorte.mx' },
    });
    expect(r.cuerpo.proveedorId).toBeTruthy();
    expect(r.cuerpo.presentaciones[0]).toMatchObject({ esPredeterminada: true });
  });

  it('rechaza lo que el proveedor no decide: proveedorId, estatus y esCanastaBasica (400)', async () => {
    for (const extra of [{ proveedorId: 'x' }, { estatus: 'activo' }, { esCanastaBasica: true }]) {
      const r = await http('POST', '/v1/products/proposals', proveedor, { ...propuesta('IT-NOPE'), ...extra });
      expect(r.estado).toBe(400);
    }
  });

  it('solo el Proveedor propone; SKU repetido responde 409', async () => {
    expect((await http('POST', '/v1/products/proposals', gerente, propuesta('IT-NOPE'))).estado).toBe(403);
    expect((await http('POST', '/v1/products/proposals', proveedor, propuesta(SKUS[0]))).estado).toBe(409);
  });

  it('el Proveedor ve su propuesta en su lista; la bandeja es solo de quien aprueba', async () => {
    const suyos = await http('GET', '/v1/products?limit=100', proveedor);
    expect(suyos.cuerpo.data.map((p: { sku: string }) => p.sku)).toContain(SKUS[0]);

    expect((await http('GET', '/v1/products/pending', proveedor)).estado).toBe(403);
    expect((await http('GET', '/v1/products/pending', auditor)).estado).toBe(403);

    const bandeja = await http('GET', '/v1/products/pending?limit=100', gerente);
    expect(bandeja.estado).toBe(200);
    const skus = bandeja.cuerpo.data.map((p: { sku: string }) => p.sku);
    expect(skus).toContain(SKUS[0]);
    expect(bandeja.cuerpo.data.every((p: { estatus: string }) => p.estatus === 'pendiente_aprobacion')).toBe(true);
    // La cola va de la más antigua a la más reciente.
    const fechas = bandeja.cuerpo.data.map((p: { createdAt: string }) => Date.parse(p.createdAt));
    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
  });

  it('aprobar: solo quien aprueba, pasa a activo y no se puede resolver dos veces', async () => {
    const id = (await http('GET', '/v1/products/pending?limit=100', gerente)).cuerpo.data.find(
      (p: { sku: string }) => p.sku === SKUS[0],
    ).id;

    expect((await http('PATCH', `/v1/products/${id}/approve`, proveedor)).estado).toBe(403);
    expect((await http('PATCH', `/v1/products/${id}/approve`, auditor)).estado).toBe(403);

    const aprobada = await http('PATCH', `/v1/products/${id}/approve`, gerente);
    expect(aprobada.estado).toBe(200);
    expect(aprobada.cuerpo.estatus).toBe('activo');

    expect((await http('PATCH', `/v1/products/${id}/approve`, gerente)).estado).toBe(409);
    expect(
      (await http('PATCH', `/v1/products/${id}/reject`, gerente, { motivoRechazo: 'Ya estaba aprobada, no aplica.' }))
        .estado,
    ).toBe(409);

    const bandeja = await http('GET', '/v1/products/pending?limit=100', gerente);
    expect(bandeja.cuerpo.data.map((p: { sku: string }) => p.sku)).not.toContain(SKUS[0]);
  });

  it('rechazar: exige motivo de 10+ caracteres y deja el producto rechazado', async () => {
    const creada = await http('POST', '/v1/products/proposals', proveedor, propuesta(SKUS[1]));
    expect(creada.estado).toBe(201);
    const id = creada.cuerpo.id;

    expect((await http('PATCH', `/v1/products/${id}/reject`, gerente, {})).estado).toBe(400);
    expect((await http('PATCH', `/v1/products/${id}/reject`, gerente, { motivoRechazo: 'corto' })).estado).toBe(400);

    const rechazada = await http('PATCH', `/v1/products/${id}/reject`, gerente, {
      motivoRechazo: 'La ficha técnica no acredita el certificado.',
    });
    expect(rechazada.estado).toBe(200);
    expect(rechazada.cuerpo.estatus).toBe('rechazado');

    expect((await http('PATCH', `/v1/products/${id}/approve`, gerente)).estado).toBe(409);
  });

  it('aprobar o rechazar un producto inexistente responde 404; un id mal formado, 400', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect((await http('PATCH', `/v1/products/${ghost}/approve`, gerente)).estado).toBe(404);
    expect((await http('PATCH', '/v1/products/abc/approve', gerente)).estado).toBe(400);
  });
});
