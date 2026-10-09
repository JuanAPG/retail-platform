/**
 * Integración de /v1/price-proposals contra el servicio real (Postgres + Redis +
 * audit-service). Mismos requisitos que `prices.spec.ts`:
 *
 *   docker compose up -d postgres redis pricing-service audit-service   # con el seed
 *   npm run test:integracion
 *
 * Aprobar una propuesta crea precios reales, así que la prueba usa una presentación
 * activa de Lácteos del Norte SIN ningún precio en el seed (la última por id, para no
 * chocar con `prices.spec.ts`, que toma la primera), trabaja solo con ella y al final
 * borra propuestas y precios y baja la caché del producto. La bitácora es append-only:
 * sus eventos se quedan.
 *
 * `revisado_por` y `creado_por` son llaves foráneas a `usuarios`: quien aprueba usa el
 * id de un usuario real. El Proveedor se vincula por correo (`proveedores.email`).
 */
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { Client } from 'pg';
import { borrarPresentaciones, crearPresentaciones, PresentacionPropia } from './fixtures';

const BASE = process.env.PRICING_BASE_URL ?? 'http://localhost:3103';
const AUDIT_BASE = process.env.AUDIT_BASE_URL ?? 'http://localhost:3110';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';
const EMAIL_PROVEEDOR = 'ventas@lacteosdelnorte.mx';
const EMAIL_OTRO_PROVEEDOR = 'contacto@bioorganicos.mx';

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

async function sesion(userId: string, rol: string, email = `${userId}@test`): Promise<string> {
  await redis.set(`session:${userId}`, '1', 'EX', 600);
  return sign({ sub: userId, email, rol, rolId: 1, jti: `jti-${userId}` }, SECRET, { expiresIn: '10m' });
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

async function bitacora(token: string, tabla: string, registroId: string) {
  const r = await fetch(`${AUDIT_BASE}/v1/auditoria?tabla=${tabla}&registroId=${registroId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(r.status).toBe(200);
  return (await r.json()) as {
    total: number;
    data: { accion: string; usuarioId: string | null; cambios: { campo: string; valorPrevio: string | null; valorPosterior: string | null }[] }[];
  };
}

describe('/v1/price-proposals (integración, requiere stack)', () => {
  let proveedor: string;
  let otroProveedor: string;
  let gerente: string;
  let preciosId: string;
  let admin: string;
  let auditor: string;
  let planeador: string;
  let precios: string;
  let presentationId: string;
  let productId: string;
  let ajena: string; // presentación de OTRA empresa
  let tiendaA: string;
  let tiendaB: string;
  let propias: PresentacionPropia[];

  const propuesta = (proposedPrice = 38) => ({ presentationId, proposedPrice, purchaseUnit: 'caja 12 pzas' });
  const crear = async (precio = 38) => (await http('POST', '/v1/price-proposals', proveedor, propuesta(precio))).cuerpo.id as string;

  const usuarioReal = async (rol: string): Promise<string> => {
    const { rows } = await db.query(
      'SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = $1 LIMIT 1',
      [rol],
    );
    return rows[0].id;
  };

  const usuarioPorCorreo = async (email: string): Promise<string> => {
    const { rows } = await db.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    return rows[0].id;
  };

  beforeAll(async () => {
    await db.connect();
    gerente = await sesion(await usuarioReal('Gerente de categoría'), 'Gerente de categoría');
    admin = await sesion(await usuarioReal('Administrador'), 'Administrador');
    preciosId = await usuarioReal('Responsable de precios');
    precios = await sesion(preciosId, 'Responsable de precios');
    auditor = await sesion('it-pp-auditor', 'Auditor');
    planeador = await sesion('it-pp-planeador', 'Planeador');
    // Cuentas Proveedor reales del seed: el token lleva su id y su correo, y la bitácora
    // guarda `usuario_id` (llave foránea a `usuarios`), igual que con un login de verdad.
    proveedor = await sesion(await usuarioPorCorreo(EMAIL_PROVEEDOR), 'Proveedor', EMAIL_PROVEEDOR);
    otroProveedor = await sesion(await usuarioPorCorreo(EMAIL_OTRO_PROVEEDOR), 'Proveedor', EMAIL_OTRO_PROVEEDOR);

    // PRI-13: presentación PROPIA del proveedor (creada aquí, borrada al final), sin precios previos.
    propias = await crearPresentaciones(db, 'PP', 1, { emailProveedor: EMAIL_PROVEEDOR });
    ({ presentacion_id: presentationId, producto_id: productId } = propias[0]);

    const otra = await db.query(
      `SELECT pres.id FROM producto_presentaciones pres JOIN productos prod ON prod.id = pres.producto_id
       JOIN proveedores pr ON pr.id = prod.proveedor_id WHERE pr.email = $1 ORDER BY pres.id LIMIT 1`,
      [EMAIL_OTRO_PROVEEDOR],
    );
    ajena = otra.rows[0].id;

    const tiendas = await db.query('SELECT id FROM tiendas ORDER BY id LIMIT 2');
    [tiendaA, tiendaB] = tiendas.rows.map((t) => t.id);
  });

  afterAll(async () => {
    await db.query('DELETE FROM precios WHERE presentacion_id = $1', [presentationId]);
    await db.query('DELETE FROM precios_propuestos_proveedor WHERE presentacion_id = $1', [presentationId]);
    // Los precios de la prueba ya no existen, pero la caché del producto seguiría mostrándolos.
    await redis.incr(`pricing:v:${productId}`);
    await redis.expire(`pricing:v:${productId}`, 86400);
    await borrarPresentaciones(db, propias);
    await db.end();
    await redis.quit();
  });

  it('sin token 401; y cada rol solo entra a lo suyo (403)', async () => {
    expect((await http('GET', '/v1/price-proposals')).estado).toBe(401);

    // Solo el Proveedor propone.
    for (const token of [admin, gerente, precios, auditor]) {
      expect((await http('POST', '/v1/price-proposals', token, propuesta())).estado).toBe(403);
    }
    // PRI-01 / D1: solo el Responsable de precios resuelve. Ni el Gerente, ni el Administrador,
    // ni el Proveedor, ni el Auditor, ni el Planeador.
    const ghost = '00000000-0000-4000-8000-000000000000';
    for (const token of [proveedor, gerente, admin, auditor, planeador]) {
      expect((await http('PATCH', `/v1/price-proposals/${ghost}/approve`, token, { storeIds: [tiendaA] })).estado).toBe(403);
      expect((await http('PATCH', `/v1/price-proposals/${ghost}/reject`, token, { rejectionReason: 'x'.repeat(12) })).estado).toBe(403);
    }
    // El Planeador no consulta propuestas.
    expect((await http('GET', '/v1/price-proposals', planeador)).estado).toBe(403);
  });

  it('valida el cuerpo y las reglas de propiedad al proponer', async () => {
    expect((await http('POST', '/v1/price-proposals', proveedor, {})).estado).toBe(400);
    expect((await http('POST', '/v1/price-proposals', proveedor, propuesta(0))).estado).toBe(400);
    // Lo que fija el servidor no se acepta en el cuerpo.
    expect((await http('POST', '/v1/price-proposals', proveedor, { ...propuesta(), supplierId: 'x' })).estado).toBe(400);
    expect((await http('POST', '/v1/price-proposals', proveedor, { ...propuesta(), status: 'aprobado' })).estado).toBe(400);

    const ghost = '00000000-0000-4000-8000-000000000000';
    expect((await http('POST', '/v1/price-proposals', proveedor, { ...propuesta(), presentationId: ghost })).estado).toBe(400);
    // Una presentación de OTRA empresa.
    expect((await http('POST', '/v1/price-proposals', proveedor, { ...propuesta(), presentationId: ajena })).estado).toBe(403);
  });

  it('ciclo de vida: proponer → no duplicar → cada Proveedor ve solo lo suyo → bandeja', async () => {
    const creada = await http('POST', '/v1/price-proposals', proveedor, propuesta(38));
    expect(creada.estado).toBe(201);
    expect(creada.cuerpo).toMatchObject({
      proposedPrice: '38.00',
      purchaseUnit: 'caja 12 pzas',
      status: 'pendiente',
      rejectionReason: null,
      reviewedBy: null,
      presentation: { id: presentationId, productoId: productId },
      supplier: { razonSocial: expect.any(String) },
    });
    const id = creada.cuerpo.id;

    // Una pendiente por presentación y proveedor.
    expect((await http('POST', '/v1/price-proposals', proveedor, propuesta(39))).estado).toBe(409);

    // Propia visible; ajena, no.
    const suyas = await http('GET', '/v1/price-proposals?limit=100', proveedor);
    expect(suyas.cuerpo.data.map((p: { id: string }) => p.id)).toContain(id);
    expect(new Set(suyas.cuerpo.data.map((p: { supplierId: string }) => p.supplierId)).size).toBe(1);
    const ajenas = await http('GET', '/v1/price-proposals?limit=100', otroProveedor);
    expect(ajenas.cuerpo.data.map((p: { id: string }) => p.id)).not.toContain(id);

    // Bandeja: solo pendientes, la más antigua primero.
    const bandeja = await http('GET', '/v1/price-proposals?status=pendiente&limit=100', gerente);
    expect(bandeja.estado).toBe(200);
    expect(bandeja.cuerpo.data.map((p: { id: string }) => p.id)).toContain(id);
    expect(bandeja.cuerpo.data.every((p: { status: string }) => p.status === 'pendiente')).toBe(true);
    const fechas = bandeja.cuerpo.data.map((p: { createdAt: string }) => Date.parse(p.createdAt));
    expect(fechas).toEqual([...fechas].sort((a, b) => a - b));

    expect((await http('GET', '/v1/price-proposals?status=otra', gerente)).estado).toBe(400);
    expect((await http('GET', '/v1/price-proposals?page=9999', gerente)).cuerpo.data).toEqual([]);

    // La propuesta quedó en la bitácora.
    const eventos = await bitacora(auditor, 'precios_propuestos_proveedor', id);
    expect(eventos.total).toBe(1);
    expect(eventos.data[0]).toMatchObject({ accion: 'insert', usuarioId: expect.any(String) });

    // Se resuelve rechazándola para dejar libre la presentación en las siguientes pruebas.
    await http('PATCH', `/v1/price-proposals/${id}/reject`, precios, { rejectionReason: 'Prueba de ciclo de vida.' });
  });

  it('rechazar: exige motivo, el Proveedor ve el motivo y no se resuelve dos veces', async () => {
    const id = await crear(41);

    expect((await http('PATCH', `/v1/price-proposals/${id}/reject`, precios, {})).estado).toBe(400);
    expect((await http('PATCH', `/v1/price-proposals/${id}/reject`, precios, { rejectionReason: 'corto' })).estado).toBe(400);

    const motivo = 'El precio propuesto excede el límite de variación de la zona.';
    const rechazada = await http('PATCH', `/v1/price-proposals/${id}/reject`, precios, { rejectionReason: motivo });
    expect(rechazada.estado).toBe(200);
    expect(rechazada.cuerpo).toMatchObject({ status: 'rechazado', rejectionReason: motivo, reviewedBy: preciosId });
    expect(rechazada.cuerpo.reviewedAt).toBeTruthy();

    // El Proveedor consulta por qué se le rechazó.
    const suyas = await http('GET', '/v1/price-proposals?status=rechazado&limit=100', proveedor);
    expect(suyas.cuerpo.data.find((p: { id: string }) => p.id === id)).toMatchObject({ rejectionReason: motivo });

    expect((await http('PATCH', `/v1/price-proposals/${id}/reject`, precios, { rejectionReason: motivo })).estado).toBe(409);
    expect((await http('PATCH', `/v1/price-proposals/${id}/approve`, precios, { storeIds: [tiendaA] })).estado).toBe(409);

    // Resuelta la anterior, ya puede volver a proponer.
    expect((await http('POST', '/v1/price-proposals', proveedor, propuesta(40))).estado).toBe(201);
    // (queda pendiente; la siguiente prueba la aprueba)
  });

  it('aprobar valida el cuerpo: tiendas obligatorias, UUID, sin repetir y existentes', async () => {
    const { cuerpo } = await http('GET', '/v1/price-proposals?status=pendiente&limit=100', gerente);
    const id = cuerpo.data.find((p: { presentationId: string }) => p.presentationId === presentationId).id;

    for (const malo of [{}, { storeIds: [] }, { storeIds: ['abc'] }, { storeIds: [tiendaA, tiendaA] }, { storeIds: [tiendaA], extra: 1 }]) {
      expect((await http('PATCH', `/v1/price-proposals/${id}/approve`, precios, malo)).estado).toBe(400);
    }
    const ghost = '00000000-0000-4000-8000-000000000000';
    const inexistente = await http('PATCH', `/v1/price-proposals/${id}/approve`, precios, { storeIds: [tiendaA, ghost] });
    expect(inexistente.estado).toBe(400);
    expect(inexistente.cuerpo.message).toContain(ghost);

    expect((await http('PATCH', `/v1/price-proposals/${ghost}/approve`, precios, { storeIds: [tiendaA] })).estado).toBe(404);
    expect((await http('PATCH', '/v1/price-proposals/abc/approve', precios, { storeIds: [tiendaA] })).estado).toBe(400);

    // Nada de lo anterior aplicó precios.
    const filas = await db.query('SELECT count(*)::int AS n FROM precios WHERE presentacion_id = $1', [presentationId]);
    expect(filas.rows[0].n).toBe(0);
  });

  it('aprobar aplica el precio a cada tienda, invalida la caché y deja todo en la bitácora', async () => {
    const id = (await http('GET', '/v1/price-proposals?status=pendiente&limit=100', gerente)).cuerpo.data.find(
      (p: { presentationId: string }) => p.presentationId === presentationId,
    ).id;

    // Calienta la caché del producto para comprobar que se invalida.
    const historial = `/v1/prices/history?productId=${productId}&presentationId=${presentationId}`;
    expect((await http('GET', historial, planeador)).cuerpo.total).toBe(0);
    const versionAntes = Number((await redis.get(`pricing:v:${productId}`)) ?? 0);

    const aprobada = await http('PATCH', `/v1/price-proposals/${id}/approve`, precios, {
      storeIds: [tiendaA, tiendaB],
      effectiveDate: '2026-10-05',
    });
    expect(aprobada.estado).toBe(200);
    expect(aprobada.cuerpo.proposal).toMatchObject({ id, status: 'aprobado', reviewedBy: preciosId });
    expect(aprobada.cuerpo.prices).toHaveLength(2);
    for (const precio of aprobada.cuerpo.prices) {
      expect(precio).toMatchObject({
        price: '40.00',
        effectiveDate: '2026-10-05',
        vigente: true,
        origen: 'propuesta_proveedor_aprobada',
        createdBy: preciosId,
        presentationId,
      });
    }
    expect(aprobada.cuerpo.prices.map((p: { storeId: string }) => p.storeId).sort()).toEqual([tiendaA, tiendaB].sort());

    // Caché: la versión subió y el historial ya muestra los precios nuevos (no el 0 cacheado).
    expect(Number(await redis.get(`pricing:v:${productId}`))).toBeGreaterThan(versionAntes);
    expect((await http('GET', historial, planeador)).cuerpo.total).toBe(2);

    // Bitácora: la resolución de la propuesta y cada precio creado.
    const resolucion = await bitacora(auditor, 'precios_propuestos_proveedor', id);
    expect(resolucion.data.map((e) => e.accion).sort()).toEqual(['insert', 'update']);
    // PRI-14: la bitácora dice quién propuso y quién aprobó (en `precios`, `creado_por` es solo quien aprueba).
    const proponente = await usuarioPorCorreo(EMAIL_PROVEEDOR);
    const evResolucion = resolucion.data.find((e) => e.accion === 'update')!;
    expect(evResolucion.cambios).toEqual(expect.arrayContaining([
      expect.objectContaining({ campo: 'propuesto_por', valorPosterior: proponente }),
      expect.objectContaining({ campo: 'aprobado_por', valorPosterior: preciosId }),
    ]));
    const eventoPrecio = await bitacora(auditor, 'precios', aprobada.cuerpo.prices[0].id);
    expect(eventoPrecio.total).toBe(1);
    expect(eventoPrecio.data[0]).toMatchObject({ accion: 'insert', usuarioId: preciosId });

    // El Proveedor ve su propuesta aprobada; no se resuelve dos veces.
    const suya = (await http('GET', '/v1/price-proposals?status=aprobado&limit=100', proveedor)).cuerpo.data.find(
      (p: { id: string }) => p.id === id,
    );
    expect(suya.status).toBe('aprobado');
    expect((await http('PATCH', `/v1/price-proposals/${id}/approve`, precios, { storeIds: [tiendaA] })).estado).toBe(409);
    expect((await http('PATCH', `/v1/price-proposals/${id}/reject`, precios, { rejectionReason: 'Ya estaba aprobada.' })).estado).toBe(409);
  });

  it('todo o nada: si una tienda tiene un precio vigente más reciente, no se aplica ninguna', async () => {
    // Estado actual: ambas tiendas tienen precio vigente desde 2026-10-05.
    const id = await crear(36);
    const antes = await db.query(
      'SELECT count(*)::int AS n, count(*) FILTER (WHERE vigente)::int AS vigentes FROM precios WHERE presentacion_id = $1',
      [presentationId],
    );

    // Fecha anterior al vigente en ambas tiendas → 409 con la tienda en el mensaje.
    const r = await http('PATCH', `/v1/price-proposals/${id}/approve`, precios, {
      storeIds: [tiendaB, tiendaA],
      effectiveDate: '2026-10-01',
    });
    expect(r.estado).toBe(409);
    expect(r.cuerpo.message).toMatch(/No se aplicó ningún precio/);

    const despues = await db.query(
      'SELECT count(*)::int AS n, count(*) FILTER (WHERE vigente)::int AS vigentes FROM precios WHERE presentacion_id = $1',
      [presentationId],
    );
    expect(despues.rows[0]).toEqual(antes.rows[0]);
    // Y la propuesta sigue pendiente (se puede aprobar con una fecha válida).
    const sigue = (await http('GET', '/v1/price-proposals?status=pendiente&limit=100', gerente)).cuerpo.data.find(
      (p: { id: string }) => p.id === id,
    );
    expect(sigue).toBeDefined();

    // Con una fecha posterior sí se aplica y cierra los vigentes de las dos tiendas.
    const bien = await http('PATCH', `/v1/price-proposals/${id}/approve`, precios, {
      storeIds: [tiendaA, tiendaB],
      effectiveDate: '2026-10-20',
    });
    expect(bien.estado).toBe(200);
    const vigentes = await db.query(
      'SELECT count(*)::int AS n FROM precios WHERE presentacion_id = $1 AND vigente AND precio = 36',
      [presentationId],
    );
    expect(vigentes.rows[0].n).toBe(2);
    const cerrados = await db.query(
      `SELECT count(*)::int AS n FROM precios WHERE presentacion_id = $1 AND NOT vigente
       AND fecha_vigencia_hasta = DATE '2026-10-19'`,
      [presentationId],
    );
    expect(cerrados.rows[0].n).toBe(2);
  });

  it('dos revisores aprobando a la vez: uno gana (200) y el otro recibe 409, sin precios duplicados', async () => {
    const id = await crear(35);
    const antes = await db.query('SELECT count(*)::int AS n FROM precios WHERE presentacion_id = $1', [presentationId]);

    const cuerpo = { storeIds: [tiendaA], effectiveDate: '2026-11-01' };
    const [a, b] = await Promise.all([
      http('PATCH', `/v1/price-proposals/${id}/approve`, precios, cuerpo),
      http('PATCH', `/v1/price-proposals/${id}/approve`, precios, cuerpo),
    ]);
    expect([a.estado, b.estado].sort()).toEqual([200, 409]);

    const despues = await db.query('SELECT count(*)::int AS n FROM precios WHERE presentacion_id = $1', [presentationId]);
    expect(despues.rows[0].n).toBe(antes.rows[0].n + 1); // un solo precio nuevo
  });

  it('XML: la lista de propuestas sale con <item>', async () => {
    const r = await http('GET', '/v1/price-proposals?limit=2', gerente, undefined, 'application/xml');
    expect(r.estado).toBe(200);
    expect(r.texto).toContain('<priceProposalListResponse');
    expect(r.texto).toContain('<proposedPrice>');
    expect(r.texto.match(/<data>/g)).toHaveLength(1);
  });
});
