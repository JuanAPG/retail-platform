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
const AUDIT = process.env.AUDIT_BASE_URL ?? 'http://localhost:3110';
const NOTIF = process.env.NOTIFICATIONS_BASE_URL ?? 'http://localhost:3109';
const EMAIL_PROV = 'ventas@lacteosdelnorte.mx';

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

/** Id del usuario con ese correo (la cuenta Proveedor real: la bitácora y los avisos exigen un usuario existente). */
async function usuarioPorCorreo(email: string): Promise<string> {
  return conDb(async (db) => (await db.query('SELECT id FROM usuarios WHERE email = $1', [email])).rows[0].id);
}

/** GET a otro servicio (auditoría o notificaciones) con un token. */
async function getDe(base: string, ruta: string, token: string) {
  const r = await fetch(`${base}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  const texto = await r.text();
  return { estado: r.status, cuerpo: texto ? JSON.parse(texto) : null };
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

const SKUS = ['IT-PROP-001', 'IT-PROP-002', 'IT-PROP-003'];
const EMAIL_OTRO = 'contacto@bioorganicos.mx';

describe('propuesta y revisión de productos (integración, requiere stack)', () => {
  let gerente: string;
  let admin: string;
  let auditor: string;
  let analista: string;
  let proveedor: string;
  let proveedorId: string;
  let otroProveedor: string;
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
    analista = await sesion('it-a-analista', 'Analista comercial');
    proveedorId = await usuarioPorCorreo(EMAIL_PROV);
    proveedor = await sesion(proveedorId, 'Proveedor', EMAIL_PROV);
    otroProveedor = await sesion(await usuarioPorCorreo(EMAIL_OTRO), 'Proveedor', EMAIL_OTRO);
    categoriaId = (await http('GET', '/v1/product-categories', auditor)).cuerpo[0].id;
  });

  afterAll(async () => {
    // Pendientes y rechazados ya no salen en /v1/products (D-08): se limpian directo en la base.
    await conDb((db) => db.query('DELETE FROM productos WHERE sku = ANY($1)', [SKUS]));
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

    // Bandeja: la resuelve el Gerente; Administrador y Auditor la leen; el resto no la ve.
    expect((await http('GET', '/v1/products/pending', proveedor)).estado).toBe(403);
    expect((await http('GET', '/v1/products/pending', analista)).estado).toBe(403);
    expect((await http('GET', '/v1/products/pending', auditor)).estado).toBe(200);
    expect((await http('GET', '/v1/products/pending', admin)).estado).toBe(200);

    const bandeja = await http('GET', '/v1/products/pending?limit=100', gerente);
    expect(bandeja.estado).toBe(200);
    const skus = bandeja.cuerpo.data.map((p: { sku: string }) => p.sku);
    expect(skus).toContain(SKUS[0]);
    expect(bandeja.cuerpo.data.every((p: { estatus: string }) => p.estatus === 'pendiente_aprobacion')).toBe(true);
    // La cola va de la más antigua a la más reciente.
    const fechas = bandeja.cuerpo.data.map((p: { createdAt: string }) => Date.parse(p.createdAt));
    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
  });

  it('D-08: un producto pendiente NO existe para el resto: ni en el catálogo ni en el detalle', async () => {
    const id = (await http('GET', '/v1/products/pending?limit=100', gerente)).cuerpo.data.find(
      (p: { sku: string }) => p.sku === SKUS[0],
    ).id;

    const catalogo = await http('GET', '/v1/products?limit=100', analista);
    expect(catalogo.cuerpo.data.map((p: { sku: string }) => p.sku)).not.toContain(SKUS[0]);
    expect((await http('GET', `/v1/products/${id}`, analista)).estado).toBe(404);
    expect((await http('GET', `/v1/products/${id}/presentations`, analista)).estado).toBe(404);

    // Quien revisa sí lo ve.
    expect((await http('GET', `/v1/products/${id}`, gerente)).estado).toBe(200);
    expect((await http('GET', `/v1/products/${id}`, auditor)).estado).toBe(200);
  });

  it('aprobar: solo quien aprueba, pasa a activo y no se puede resolver dos veces', async () => {
    const id = (await http('GET', '/v1/products/pending?limit=100', gerente)).cuerpo.data.find(
      (p: { sku: string }) => p.sku === SKUS[0],
    ).id;

    expect((await http('PATCH', `/v1/products/${id}/approve`, proveedor)).estado).toBe(403);
    expect((await http('PATCH', `/v1/products/${id}/approve`, auditor)).estado).toBe(403);
    // CAT-05: el Administrador no aprueba ni rechaza.
    expect((await http('PATCH', `/v1/products/${id}/approve`, admin)).estado).toBe(403);
    expect((await http('PATCH', `/v1/products/${id}/reject`, admin, { motivoRechazo: 'No me corresponde decidir.' })).estado).toBe(403);

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

    // Ya aprobado, aparece en el catálogo general.
    const catalogo = await http('GET', '/v1/products?limit=100', analista);
    expect(catalogo.cuerpo.data.map((p: { sku: string }) => p.sku)).toContain(SKUS[0]);
  });

  it('CAT-08: proponer, aprobar y rechazar dejan su evento en audit-service, con quién y qué cambió', async () => {
    const aprobado = (await http('GET', '/v1/products?limit=100', analista)).cuerpo.data.find((p: { sku: string }) => p.sku === SKUS[0]);
    const eventos = (await getDe(AUDIT, `/v1/auditoria?tabla=productos&registroId=${aprobado.id}&limit=50`, admin)).cuerpo.data;

    const alta = eventos.find((e: { accion: string }) => e.accion === 'insert');
    expect(alta).toMatchObject({ tablaAfectada: 'productos', registroId: aprobado.id, usuarioId: proveedorId, servicio: 'catalog-service' });

    const aprob = eventos.find((e: { accion: string }) => e.accion === 'aprobar');
    expect(aprob).toBeDefined();
    expect(aprob.cambios).toEqual(expect.arrayContaining([expect.objectContaining({ campo: 'estatus' })]));
    const cambio = aprob.cambios.find((c: { campo: string }) => c.campo === 'estatus');
    expect(cambio.valorPrevio).toBe('pendiente_aprobacion');
    expect(cambio.valorPosterior).toBe('activo');
  });

  it('CAT-09: proponer avisa al Gerente; aprobar avisa al Proveedor que propuso', async () => {
    const producto = (await http('GET', '/v1/products?limit=100', analista)).cuerpo.data.find((p: { sku: string }) => p.sku === SKUS[0]);

    // El Gerente (por rol) ve el aviso de la propuesta.
    const delGerente = (await getDe(NOTIF, '/v1/notifications?limit=100', gerente)).cuerpo.data;
    const propuesto = delGerente.find((n: { eventType: string; relatedEntityId: string }) => n.eventType === 'producto.propuesto' && n.relatedEntityId === producto.id);
    expect(propuesto).toMatchObject({ sourceService: 'catalog-service', relatedEntityType: 'producto' });

    // El Proveedor (por su usuario) ve que su propuesta se resolvió.
    const delProveedor = (await getDe(NOTIF, '/v1/notifications?limit=100', proveedor)).cuerpo.data;
    const resuelto = delProveedor.find((n: { eventType: string; relatedEntityId: string }) => n.eventType === 'propuesta.resuelta' && n.relatedEntityId === producto.id);
    expect(resuelto).toBeDefined();
    expect(resuelto.title).toContain('aprobada');
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

    // CAT-08: el rechazo queda en la bitácora con su motivo; un 409 posterior NO deja evento.
    const eventos = (await getDe(AUDIT, `/v1/auditoria?tabla=productos&registroId=${id}&limit=50`, admin)).cuerpo.data;
    const rechazo = eventos.filter((e: { accion: string }) => e.accion === 'rechazar');
    expect(rechazo).toHaveLength(1);
    expect(rechazo[0].descripcion).toContain('La ficha técnica no acredita el certificado.');
    expect(eventos.filter((e: { accion: string }) => e.accion === 'aprobar')).toHaveLength(0);

    // CAT-09: el Proveedor recibe el rechazo con su motivo.
    const avisos = (await getDe(NOTIF, '/v1/notifications?limit=100', proveedor)).cuerpo.data;
    const aviso = avisos.find((n: { eventType: string; relatedEntityId: string }) => n.eventType === 'propuesta.resuelta' && n.relatedEntityId === id);
    expect(aviso.title).toContain('rechazada');
    expect(aviso.message).toContain('La ficha técnica no acredita el certificado.');
  });

  it('CAT-14 / D-11: el Proveedor edita su propuesta pendiente; la de otro es 404; una resuelta es 409', async () => {
    const creada = await http('POST', '/v1/products/proposals', proveedor, propuesta(SKUS[2]));
    expect(creada.estado).toBe(201);
    const id = creada.cuerpo.id;

    // El Proveedor ve el detalle de SU propuesta pendiente; el de otro, no.
    expect((await http('GET', `/v1/products/${id}`, proveedor)).estado).toBe(200);
    expect((await http('GET', `/v1/products/${id}`, otroProveedor)).estado).toBe(404);

    const editada = await http('PATCH', `/v1/products/proposals/${id}`, proveedor, {
      nombre: 'Propuesta corregida',
      presentacion: '450 g',
      contenido: 450,
    });
    expect(editada.estado).toBe(200);
    expect(editada.cuerpo).toMatchObject({ nombre: 'Propuesta corregida', estatus: 'pendiente_aprobacion', sku: SKUS[2] });
    expect(editada.cuerpo.presentaciones[0]).toMatchObject({ nombre: '450 g', contenido: '450.000' });

    // Lo que el Proveedor no decide sigue siendo 400; otros roles y otros proveedores, no.
    for (const extra of [{ sku: 'X' }, { estatus: 'activo' }, { esCanastaBasica: true }, { proveedorId: 'x' }]) {
      expect((await http('PATCH', `/v1/products/proposals/${id}`, proveedor, extra)).estado).toBe(400);
    }
    expect((await http('PATCH', `/v1/products/proposals/${id}`, otroProveedor, { nombre: 'Intruso' })).estado).toBe(404);
    expect((await http('PATCH', `/v1/products/proposals/${id}`, gerente, { nombre: 'Gerente' })).estado).toBe(403);
    expect((await http('PATCH', `/v1/products/proposals/${id}`, admin, { nombre: 'Admin' })).estado).toBe(403);
    expect((await http('PATCH', `/v1/products/proposals/${id}`, proveedor, { categoriaId: 9999 })).estado).toBe(400);

    // El cambio se auditó (CAT-08).
    const eventos = (await getDe(AUDIT, `/v1/auditoria?tabla=productos&registroId=${id}&limit=50`, admin)).cuerpo.data;
    const edicion = eventos.find((e: { accion: string }) => e.accion === 'update');
    expect(edicion.cambios).toEqual(expect.arrayContaining([expect.objectContaining({ campo: 'nombre', valorPosterior: 'Propuesta corregida' })]));

    // Una vez rechazada ya no se edita: hace una propuesta nueva.
    await http('PATCH', `/v1/products/${id}/reject`, gerente, { motivoRechazo: 'No cumple con la ficha técnica.' });
    const tarde = await http('PATCH', `/v1/products/proposals/${id}`, proveedor, { nombre: 'Tarde' });
    expect(tarde.estado).toBe(409);
    expect(tarde.cuerpo.message).toContain('propuesta nueva');
  });

  it('aprobar o rechazar un producto inexistente responde 404; un id mal formado, 400', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect((await http('PATCH', `/v1/products/${ghost}/approve`, gerente)).estado).toBe(404);
    expect((await http('PATCH', '/v1/products/abc/approve', gerente)).estado).toBe(400);
  });
});
