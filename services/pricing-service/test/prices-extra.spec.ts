/**
 * Integración de los pendientes PRI-05, PRI-07, PRI-09, PRI-11 y PRI-12 contra el servicio real. Requisitos:
 *
 *   docker compose -f infra/docker-compose.yml up -d postgres redis audit-service notifications-service catalog-service pricing-service
 *   npm run test:integracion
 *
 * Cada prueba trabaja con SU PROPIA pareja presentación + tienda (de un producto activo, sin precios en esa tienda) y
 * borra lo que creó: no depende del estado de la base ni del orden de los demás archivos. Las pruebas de alertas usan
 * presentaciones DISTINTAS porque notifications-service no duplica un aviso del mismo evento y entidad en 5 minutos.
 */
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { Client } from 'pg';

const BASE = process.env.PRICING_BASE_URL ?? 'http://localhost:3103';
const AUDIT = process.env.AUDIT_BASE_URL ?? 'http://localhost:3110';
const NOTIF = process.env.NOTIFICATIONS_BASE_URL ?? 'http://localhost:3109';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';

const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: parseInt(process.env.REDIS_PORT ?? '6379', 10) });
const db = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  user: process.env.DB_USER ?? 'retail_user',
  password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
  database: process.env.DB_NAME ?? 'retaildb',
});

async function sesion(userId: string, rol: string, email = `${userId}@test`): Promise<string> {
  await redis.set(`session:${userId}`, '1', 'EX', 900);
  return sign({ sub: userId, email, rol, rolId: 1, jti: `jti-${userId}` }, SECRET, { expiresIn: '15m' });
}

async function http(metodo: string, ruta: string, token?: string, cuerpo?: object, accept?: string, base = BASE) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(accept ? { Accept: accept } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  let cuerpoJson: any = null;
  try { cuerpoJson = JSON.parse(texto); } catch { /* XML */ }
  return { estado: r.status, cuerpo: cuerpoJson, texto };
}

const usuarioReal = async (rol: string): Promise<string> =>
  (await db.query('SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = $1 LIMIT 1', [rol])).rows[0].id;

describe('pricing: programados, series, alertas, observaciones y límites (integración, requiere stack)', () => {
  let precios: string;
  let preciosId: string;
  let analista: string;
  let analistaId: string;
  let admin: string;
  let auditor: string;
  let planeador: string;
  let proveedor: string;
  let presentationId: string;
  let productId: string;
  let storeId: string;
  let zoneId: string;
  let parejas: Array<{ presentacion_id: string; producto_id: string; tienda_id: string; zona_id: string }>;

  /** Cambia la pareja con la que trabaja la prueba en curso. */
  const usar = (k: number) => {
    ({ presentacion_id: presentationId, producto_id: productId, tienda_id: storeId, zona_id: zoneId } = parejas[k % parejas.length]);
  };

  const alta = (price: number, effectiveDate: string) => ({ presentationId, storeId, price, effectiveDate });

  async function limpiar() {
    await db.query('DELETE FROM precios_observados WHERE presentacion_id = $1 AND tienda_id = $2', [presentationId, storeId]);
    await db.query('DELETE FROM precios WHERE presentacion_id = $1 AND tienda_id = $2', [presentationId, storeId]);
    await db.query('DELETE FROM config_alertas_precio');
    await redis.incr(`pricing:v:${productId}`);
    await redis.expire(`pricing:v:${productId}`, 86400);
  }

  beforeAll(async () => {
    await db.connect();
    preciosId = await usuarioReal('Responsable de precios');
    precios = await sesion(preciosId, 'Responsable de precios');
    analistaId = await usuarioReal('Analista comercial');
    analista = await sesion(analistaId, 'Analista comercial');
    admin = await sesion(await usuarioReal('Administrador'), 'Administrador');
    auditor = await sesion('it-px-auditor', 'Auditor');
    planeador = await sesion('it-px-planeador', 'Planeador');
    proveedor = await sesion('it-px-prov', 'Proveedor');

    // Una pareja por presentación activa: la primera tienda en la que esa presentación aún no tiene precio.
    parejas = (
      await db.query(`
        SELECT DISTINCT ON (pres.id) pres.id AS presentacion_id, pres.producto_id, t.id AS tienda_id, t.zona_id
        FROM producto_presentaciones pres
        JOIN productos prod ON prod.id = pres.producto_id AND prod.estatus = 'activo'
        CROSS JOIN tiendas t
        WHERE NOT EXISTS (SELECT 1 FROM precios p WHERE p.presentacion_id = pres.id AND p.tienda_id = t.id)
        ORDER BY pres.id DESC, t.id`)
    ).rows;
    expect(parejas.length).toBeGreaterThanOrEqual(4);
    usar(0);
    await limpiar();
  });

  afterAll(async () => {
    for (let k = 0; k < Math.min(parejas.length, 6); k++) {
      usar(k);
      await limpiar();
    }
    await db.end();
    await redis.quit();
  });

  // ---------------------------------------------------------------- PRI-05
  it('PRI-05 / D-05: un precio con fecha futura NO reemplaza al de hoy; entra en vigor en su fecha', async () => {
    usar(3);
    const hoy = new Date().toISOString().slice(0, 10);
    const manana = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const pasado = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);

    const actual = await http('POST', '/v1/prices', precios, alta(13.5, pasado));
    expect(actual.estado).toBe(201);
    expect(actual.cuerpo.vigente).toBe(true);

    const futuro = await http('POST', '/v1/prices', precios, alta(99, manana));
    expect(futuro.estado).toBe(201);
    expect(futuro.cuerpo).toMatchObject({ price: '99.00', effectiveDate: manana, vigente: false }); // aún no rige

    // El anterior se cierra con hasta = desde_nuevo - 1 (sigue siendo el actual hasta entonces).
    const historia = (await http('GET', `/v1/prices/history?productId=${productId}&presentationId=${presentationId}&limit=100`, auditor)).cuerpo.data;
    const viejo = historia.find((p: { price: string; storeId: string }) => p.price === '13.50' && p.storeId === storeId);
    expect(viejo.effectiveUntil).toBe(new Date(new Date(`${manana}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10));
    expect(viejo.vigente).toBe(true);

    // compare-zones muestra lo de HOY, calculado por fecha en SQL: el precio futuro no entra al promedio.
    const esperado = async () =>
      Number(
        (
          await db.query(
            `SELECT avg(p.precio)::float AS media FROM precios p JOIN tiendas t ON t.id = p.tienda_id
             WHERE p.presentacion_id = $1 AND t.zona_id = $2 AND p.fecha_vigencia_desde <= (now() AT TIME ZONE 'America/Monterrey')::date
               AND (p.fecha_vigencia_hasta IS NULL OR p.fecha_vigencia_hasta >= (now() AT TIME ZONE 'America/Monterrey')::date)`,
            [presentationId, zoneId],
          )
        ).rows[0].media,
      );
    const mediaZona = async () => {
      const cmp = (await http('GET', `/v1/prices/compare-zones?productId=${productId}`, auditor)).cuerpo;
      return cmp.zones.find((z: { zoneId: string; presentationId: string }) => z.zoneId === zoneId && z.presentationId === presentationId).averagePrice;
    };
    expect(await mediaZona()).toBeCloseTo(await esperado(), 2);
    expect((await esperado())).not.toBeCloseTo(99, 0); // el futuro no está dentro del promedio de hoy

    // El endpoint de precio actual tampoco lo ve.
    const current = await http('GET', `/v1/prices/current?presentationId=${presentationId}&storeId=${storeId}`, planeador);
    expect(current.estado).toBe(200);
    expect(current.cuerpo.data.map((p: { price: string }) => p.price)).toEqual(['13.50']);

    // Cuando llega su fecha, pasa a ser el actual SIN intervención: simulamos el paso del tiempo corriendo las fechas 3 días atrás.
    await db.query(
      `UPDATE precios SET fecha_vigencia_desde = fecha_vigencia_desde - 3, fecha_vigencia_hasta = fecha_vigencia_hasta - 3 WHERE presentacion_id = $1`,
      [presentationId],
    );
    await redis.incr(`pricing:v:${productId}`);
    await db.query(`UPDATE precios SET fecha_vigencia_desde = fecha_vigencia_desde WHERE false`);
    const luego = await http('GET', `/v1/prices/current?presentationId=${presentationId}&storeId=${storeId}`, planeador);
    expect(luego.cuerpo.data.map((p: { price: string }) => p.price)).toEqual(['99.00']);
    expect(await mediaZona()).toBeCloseTo(await esperado(), 2);
    expect(hoy).toBeTruthy();
    await limpiar();
  });

  // ---------------------------------------------------------------- PRI-11
  it('PRI-11: current y series entregan precios sin leer la tabla; series va completa y sin paginar', async () => {
    usar(0);
    const deMiTienda = (r: { cuerpo: { data: any[] } }) => r.cuerpo.data.filter((p) => p.storeId === storeId);
    for (const [precio, fecha] of [[10, '2026-01-01'], [11, '2026-02-01'], [12, '2026-03-01'], [13, '2026-04-01']] as const) {
      expect((await http('POST', '/v1/prices', precios, alta(precio, fecha))).estado).toBe(201);
    }
    const serie = await http('GET', `/v1/prices/series?presentationId=${presentationId}`, analista);
    expect(serie.estado).toBe(200);
    expect(serie.cuerpo.total).toBe(serie.cuerpo.data.length); // trae TODO lo de la presentación, sin límite de página
    expect(serie.cuerpo).not.toHaveProperty('page'); // sin paginar
    const mias = deMiTienda(serie);
    expect(mias.map((p: { price: string }) => p.price)).toEqual(['10.00', '11.00', '12.00', '13.00']); // por fecha de inicio
    expect(mias[0]).toMatchObject({ effectiveUntil: '2026-01-31', store: { id: storeId, zonaId: zoneId } });
    expect(mias[3].effectiveUntil).toBeNull();

    // Rango: trae los precios cuya vigencia se cruza con él.
    const rango = await http('GET', `/v1/prices/series?presentationId=${presentationId}&dateFrom=2026-02-10&dateTo=2026-03-10`, analista);
    expect(deMiTienda(rango).map((p: { price: string }) => p.price)).toEqual(['11.00', '12.00']);

    // Validaciones.
    expect((await http('GET', '/v1/prices/series', analista)).estado).toBe(400);
    expect((await http('GET', '/v1/prices/series?presentationId=abc', analista)).estado).toBe(400);
    expect((await http('GET', `/v1/prices/series?presentationId=${presentationId}&dateFrom=2026-12-01&dateTo=2026-01-01`, analista)).estado).toBe(400);
    expect((await http('GET', '/v1/prices/series?presentationId=00000000-0000-4000-8000-000000000000', analista)).estado).toBe(400);
    expect((await http('GET', '/v1/prices/series', proveedor)).estado).toBe(403);
    expect((await http('GET', `/v1/prices/current?presentationId=${presentationId}&zoneId=${zoneId}&storeId=${storeId}`, analista)).cuerpo.total).toBe(1);

    // XML con el namespace y la raíz del contrato.
    const xml = await http('GET', `/v1/prices/series?presentationId=${presentationId}`, analista, undefined, 'application/xml');
    expect(xml.texto).toContain('<priceSeriesResponse xmlns="pricing/v1">');
    await limpiar();
  });

  // ---------------------------------------------------------------- PRI-12
  it('PRI-12: un cuerpo de 5 MB responde 413 con el error estándar (no 500)', async () => {
    usar(0);
    const grande = { presentationId, storeId, price: 10, relleno: 'x'.repeat(5 * 1024 * 1024) };
    const r = await http('POST', '/v1/prices', precios, grande);
    expect(r.estado).toBe(413);
    expect(r.cuerpo).toMatchObject({ statusCode: 413, code: 'VALIDATION_ERROR', path: '/v1/prices' });
    expect(Object.keys(r.cuerpo).sort()).toEqual(['code', 'details', 'message', 'path', 'statusCode', 'timestamp']);
    expect(r.cuerpo.message).not.toMatch(/internal|stack/i);

    const xml = await http('POST', '/v1/prices', precios, grande, 'application/xml');
    expect(xml.estado).toBe(413);
    expect(xml.texto).toContain('<error');
  });

  // ---------------------------------------------------------------- PRI-07
  it('PRI-07 / D-09: el Responsable configura umbral y ventana; los demás no (403) y se valida el rango', async () => {
    const porDefecto = await http('GET', '/v1/prices/alert-settings', precios);
    expect(porDefecto.estado).toBe(200);
    expect(porDefecto.cuerpo).toMatchObject({ umbralPct: 5, ventanaDias: 30 });

    expect((await http('PUT', '/v1/prices/alert-settings', admin, { umbralPct: 10, ventanaDias: 7 })).estado).toBe(403);
    expect((await http('PUT', '/v1/prices/alert-settings', proveedor, { umbralPct: 10, ventanaDias: 7 })).estado).toBe(403);
    expect((await http('GET', '/v1/prices/alert-settings', planeador)).estado).toBe(403);
    for (const malo of [{ umbralPct: 0, ventanaDias: 7 }, { umbralPct: 101, ventanaDias: 7 }, { umbralPct: 5, ventanaDias: 0 }, { umbralPct: 5, ventanaDias: 400 }, { umbralPct: 5 }, { umbralPct: 5, ventanaDias: 7, extra: 1 }]) {
      expect((await http('PUT', '/v1/prices/alert-settings', precios, malo)).estado).toBe(400);
    }

    const r = await http('PUT', '/v1/prices/alert-settings', precios, { umbralPct: 5, ventanaDias: 1 });
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ umbralPct: 5, ventanaDias: 1, updatedBy: preciosId });
    expect((await http('GET', '/v1/prices/alert-settings', auditor)).cuerpo.ventanaDias).toBe(1);
  });

  it('PRI-07 / D-09: un cambio de 4.99 % NO avisa; uno de 5 % SÍ, y le llega al Responsable de precios', async () => {
    usar(1);
    await http('PUT', '/v1/prices/alert-settings', precios, { umbralPct: 5, ventanaDias: 1 }); // base = el precio de ayer
    // Se filtra por el CONTENIDO del aviso (los precios de esta prueba), porque las notificaciones persisten entre pruebas y corridas.
    const avisos = async (precioNuevo: string) =>
      ((await http('GET', '/v1/notifications?limit=100', precios, undefined, undefined, NOTIF)).cuerpo?.data ?? []).filter(
        (n: { eventType: string; relatedEntityId: string; message: string }) =>
          n.eventType === 'precio.umbral' && n.relatedEntityId === presentationId && n.message.includes(`a ${precioNuevo} `),
      );

    expect((await http('POST', '/v1/prices', precios, alta(100, '2026-05-01'))).estado).toBe(201); // primer precio: no hay con qué comparar
    expect(await avisos('100.00')).toHaveLength(0);

    expect((await http('POST', '/v1/prices', precios, alta(104.99, '2026-05-03'))).estado).toBe(201); // 4.99 %
    expect(await avisos('104.99')).toHaveLength(0);

    expect((await http('POST', '/v1/prices', precios, alta(110.24, '2026-05-05'))).estado).toBe(201); // 5.0005 % sobre 104.99
    const hechos = await avisos('110.24');
    expect(hechos).toHaveLength(1);
    expect(hechos[0]).toMatchObject({ sourceService: 'pricing-service', relatedEntityType: 'presentacion' });
    expect(hechos[0].title).toContain('5 %');
    expect(hechos[0].message).toContain('subió de 104.99 a 110.24');
    await limpiar();
  });

  it('PRI-07: el cambio ACUMULADO en la ventana también avisa aunque cada paso quede bajo el umbral', async () => {
    usar(2);
    await http('PUT', '/v1/prices/alert-settings', precios, { umbralPct: 5, ventanaDias: 10 });
    // Se filtra por el CONTENIDO del aviso (los precios de esta prueba), porque las notificaciones persisten entre pruebas y corridas.
    const avisos = async (precioNuevo: string) =>
      ((await http('GET', '/v1/notifications?limit=100', precios, undefined, undefined, NOTIF)).cuerpo?.data ?? []).filter(
        (n: { eventType: string; relatedEntityId: string; message: string }) =>
          n.eventType === 'precio.umbral' && n.relatedEntityId === presentationId && n.message.includes(`a ${precioNuevo} `),
      );
    // +1 % por día durante 6 días: ninguno pasa de 1 %, pero contra el precio de hace 10 días el acumulado sí.
    let precio = 100;
    expect((await http('POST', '/v1/prices', precios, alta(precio, '2026-06-01'))).estado).toBe(201);
    for (let dia = 2; dia <= 7; dia++) {
      precio = Math.round(precio * 1.01 * 100) / 100;
      expect((await http('POST', '/v1/prices', precios, alta(precio, `2026-06-0${dia}`))).estado).toBe(201);
    }
    // El historial es más corto que la ventana: la base es el precio más antiguo (100). El primer paso que cruza el 5 %
    // es 105.10 (5.10 %); los de 101, 102.01, 103.03 y 104.06 (1 % a 4.06 %) no avisaron. El de 106.15 ya no genera un
    // aviso nuevo: notifications-service no repite el mismo evento y entidad en 5 minutos.
    expect(await avisos('105.10')).toHaveLength(1);
    for (const antes of ['101.00', '102.01', '103.03', '104.06']) expect(await avisos(antes)).toHaveLength(0);
    await limpiar();
  });

  // ---------------------------------------------------------------- PRI-09
  it('PRI-09 / D-16: una observación pendiente NO cambia el precio; al aprobarla entra al historial y la bitácora dice "observado en campo"', async () => {
    usar(0);
    const deMiTienda = (lista: any[]) => lista.filter((p) => p.storeId === storeId);
    expect((await http('POST', '/v1/prices', precios, alta(20, '2026-01-01'))).estado).toBe(201);
    const obsBody = { presentationId, storeId, price: 27.5, observedAt: '2026-10-07T15:30:00Z', lat: 25.6866, lng: -100.3161 };

    // Quién captura: Analista y Responsable. Proveedor, Auditor, Planeador y Administrador, no.
    for (const token of [proveedor, auditor, planeador, admin]) {
      expect((await http('POST', '/v1/price-observations', token, obsBody)).estado).toBe(403);
    }
    const creada = await http('POST', '/v1/price-observations', analista, obsBody);
    expect(creada.estado).toBe(201);
    const id = creada.cuerpo.id;
    expect(creada.cuerpo).toMatchObject({ status: 'pendiente', origin: 'observado_en_campo', price: '27.50', lat: 25.6866, lng: -100.3161, capturedBy: analistaId, priceId: null });

    // Mientras está pendiente, el precio actual sigue siendo 20.
    const actual = await http('GET', `/v1/prices/current?presentationId=${presentationId}&storeId=${storeId}`, planeador);
    expect(actual.cuerpo.data.map((p: { price: string }) => p.price)).toEqual(['20.00']);

    // Bandeja: el Responsable la ve; el Analista, solo la suya; el Planeador y el Proveedor, no.
    const bandeja = await http('GET', '/v1/price-observations?status=pendiente&limit=100', precios);
    expect(bandeja.cuerpo.data.map((o: { id: string }) => o.id)).toContain(id);
    expect((await http('GET', '/v1/price-observations?status=pendiente&limit=100', analista)).cuerpo.data.map((o: { id: string }) => o.id)).toContain(id);
    expect((await http('GET', '/v1/price-observations', planeador)).estado).toBe(403);
    expect((await http('GET', '/v1/price-observations', proveedor)).estado).toBe(403);
    expect((await http('GET', '/v1/price-observations?status=otra', precios)).estado).toBe(400);

    // Solo el Responsable resuelve (ni el Administrador, ni el Analista que la capturó).
    for (const token of [admin, analista, auditor]) {
      expect((await http('PATCH', `/v1/price-observations/${id}/approve`, token, {})).estado).toBe(403);
    }
    const aprobada = await http('PATCH', `/v1/price-observations/${id}/approve`, precios, { effectiveDate: '2026-10-08' });
    expect(aprobada.estado).toBe(200);
    expect(aprobada.cuerpo).toMatchObject({ status: 'aprobado', reviewedBy: preciosId });
    expect(aprobada.cuerpo.priceId).toBeTruthy();

    // Ya es un precio NORMAL (origen interno), vigente y con quien aprobó como autor.
    const serie = deMiTienda((await http('GET', `/v1/prices/series?presentationId=${presentationId}`, analista)).cuerpo.data);
    const nuevo = serie.find((p: { price: string }) => p.price === '27.50');
    expect(nuevo).toMatchObject({ origen: 'interno', createdBy: preciosId, effectiveDate: '2026-10-08' });
    expect(serie.find((p: { price: string }) => p.price === '20.00').effectiveUntil).toBe('2026-10-07');
    expect(nuevo.id).toBe(aprobada.cuerpo.priceId);

    // La bitácora SÍ lo distingue: origen observado_en_campo, quién capturó y quién aprobó.
    const eventos = ((await http('GET', `/v1/auditoria?tabla=precios_observados&registroId=${id}&limit=50`, admin, undefined, undefined, AUDIT)).cuerpo.data) as Array<{ accion: string; cambios: Array<{ campo: string; valorPosterior: string | null }> }>;
    const evAlta = eventos.find((e) => e.accion === 'insert')!;
    expect(evAlta.cambios).toEqual(expect.arrayContaining([expect.objectContaining({ campo: 'origen', valorPosterior: 'observado_en_campo' })]));
    const aprob = eventos.find((e) => e.accion === 'aprobar')!;
    expect(aprob.cambios).toEqual(expect.arrayContaining([
      expect.objectContaining({ campo: 'origen', valorPosterior: 'observado_en_campo' }),
      expect.objectContaining({ campo: 'capturado_por', valorPosterior: analistaId }),
      expect.objectContaining({ campo: 'aprobado_por', valorPosterior: preciosId }),
    ]));
    const eventosPrecio = ((await http('GET', `/v1/auditoria?tabla=precios&registroId=${nuevo.id}&limit=10`, admin, undefined, undefined, AUDIT)).cuerpo.data) as Array<{ cambios: Array<{ campo: string; valorPosterior: string | null }> }>;
    expect(eventosPrecio[0].cambios).toEqual(expect.arrayContaining([expect.objectContaining({ campo: 'origen', valorPosterior: 'observado_en_campo' })]));

    // Una vez resuelta no se vuelve a resolver.
    expect((await http('PATCH', `/v1/price-observations/${id}/approve`, precios, {})).estado).toBe(409);
    expect((await http('PATCH', `/v1/price-observations/${id}/reject`, precios, { rejectionReason: 'Ya estaba aprobada, no aplica.' })).estado).toBe(409);
    await limpiar();
  });

  it('PRI-09: rechazar exige motivo, deja la observación rechazada y NO toca el historial', async () => {
    usar(0);
    expect((await http('POST', '/v1/prices', precios, alta(20, '2026-01-01'))).estado).toBe(201);
    const id = (await http('POST', '/v1/price-observations', precios, { presentationId, storeId, price: 5 })).cuerpo.id;

    expect((await http('PATCH', `/v1/price-observations/${id}/reject`, precios, {})).estado).toBe(400);
    expect((await http('PATCH', `/v1/price-observations/${id}/reject`, precios, { rejectionReason: 'corto' })).estado).toBe(400);
    const r = await http('PATCH', `/v1/price-observations/${id}/reject`, precios, { rejectionReason: 'El precio no coincide con la foto del anaquel.' });
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ status: 'rechazado', rejectionReason: 'El precio no coincide con la foto del anaquel.', priceId: null });

    expect((await http('GET', `/v1/prices/series?presentationId=${presentationId}`, precios)).cuerpo.data.filter((p: { storeId: string }) => p.storeId === storeId)).toHaveLength(1); // solo el de 20
    expect((await http('PATCH', `/v1/price-observations/${id}/approve`, precios, {})).estado).toBe(409);
    expect((await http('PATCH', '/v1/price-observations/00000000-0000-4000-8000-000000000000/approve', precios, {})).estado).toBe(404);
    expect((await http('PATCH', '/v1/price-observations/abc/approve', precios, {})).estado).toBe(400);
    await limpiar();
  });

  it('PRI-09: valida el cuerpo (precio, GPS, fecha futura, ids inexistentes y campos que fija el servidor)', async () => {
    usar(0);
    const base = { presentationId, storeId, price: 10 };
    for (const malo of [
      {},
      { ...base, price: 0 },
      { ...base, price: -3 },
      { ...base, price: 10.123 },
      { ...base, lat: 100, lng: 0 },
      { ...base, lat: 10, lng: 200 },
      { ...base, lat: 10 }, // lat sin lng
      { ...base, observedAt: new Date(Date.now() + 86400000).toISOString() },
      { ...base, presentationId: '00000000-0000-4000-8000-000000000000' },
      { ...base, storeId: '00000000-0000-4000-8000-000000000000' },
      { ...base, capturedBy: 'x' },
      { ...base, status: 'aprobado' },
    ]) {
      expect((await http('POST', '/v1/price-observations', analista, malo)).estado).toBe(400);
    }
    // Un producto pendiente no admite observaciones (409, D-08).
    const pendiente = await db.query(`
      SELECT pres.id FROM producto_presentaciones pres JOIN productos prod ON prod.id = pres.producto_id
      WHERE prod.estatus <> 'activo' LIMIT 1`);
    if (pendiente.rows[0]) {
      expect((await http('POST', '/v1/price-observations', analista, { ...base, presentationId: pendiente.rows[0].id })).estado).toBe(409);
    }
  });

  it('XML: priceObservationResponse, priceObservationListResponse y priceAlertSettingsResponse con el namespace pricing/v1', async () => {
    usar(0);
    const id = (await http('POST', '/v1/price-observations', analista, { presentationId, storeId, price: 9.5 })).cuerpo.id;
    const uno = await http('PATCH', `/v1/price-observations/${id}/reject`, precios, { rejectionReason: 'Prueba de la salida en XML.' }, 'application/xml');
    expect(uno.estado).toBe(200);
    expect(uno.texto).toContain('<priceObservationResponse xmlns="pricing/v1">');
    expect(uno.texto).toContain('<origin>observado_en_campo</origin>');

    const lista = await http('GET', '/v1/price-observations?limit=2', precios, undefined, 'application/xml');
    expect(lista.texto).toContain('<priceObservationListResponse xmlns="pricing/v1">');
    const config = await http('GET', '/v1/prices/alert-settings', precios, undefined, 'application/xml');
    expect(config.texto).toContain('<priceAlertSettingsResponse xmlns="pricing/v1">');
    await limpiar();
  });
});
