/**
 * Integración de `GET /v1/prices/variation` (T-22) contra el servicio real (Postgres + Redis).
 *
 * Requiere: `docker compose up -d postgres redis pricing-service` con el seed cargado.
 *   npm run test:integracion
 *
 * Crea SUS presentaciones (PRI-13) y siembra su histórico por SQL: es el andamiaje de la
 * prueba; lo que se prueba es la lectura. Borra todo al terminar.
 */
import { spawnSync } from 'child_process';
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { join } from 'path';
import { Client } from 'pg';
import { borrarPresentaciones, crearPresentaciones, PresentacionPropia } from './fixtures';

const BASE = process.env.PRICING_BASE_URL ?? 'http://localhost:3103';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';
const XSD = join(__dirname, '..', '..', '..', 'docs', 'contratos', 'pricing-service.xsd');

const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: parseInt(process.env.REDIS_PORT ?? '6379', 10) });
const db = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  user: process.env.DB_USER ?? 'retail_user',
  password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
  database: process.env.DB_NAME ?? 'retaildb',
});

async function sesion(userId: string, rol: string): Promise<string> {
  await redis.set(`session:${userId}`, '1', 'EX', 900);
  return sign({ sub: userId, email: `${userId}@test`, rol, rolId: 1, jti: `jti-${userId}-${Date.now()}` }, SECRET, { expiresIn: '15m' });
}

async function http(ruta: string, token?: string, accept?: string) {
  const r = await fetch(`${BASE}${ruta}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(accept ? { Accept: accept } : {}) },
  });
  const texto = await r.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cuerpo: any = null;
  try { cuerpo = JSON.parse(texto); } catch { /* XML */ }
  return { estado: r.status, cuerpo, texto };
}

/** `null` si el XML valida contra pricing-service.xsd; `'sin-validador'` si no hay Python con lxml. */
function errorDeXsd(xml: string): string | null {
  const codigo =
    'import sys\ntry:\n    from lxml import etree\nexcept ImportError:\n    sys.exit(3)\n' +
    's = etree.XMLSchema(etree.parse(sys.argv[1]))\nd = etree.fromstring(sys.stdin.buffer.read())\n' +
    'ok = s.validate(d)\nprint("" if ok else "; ".join(str(e) for e in s.error_log))\nsys.exit(0 if ok else 1)\n';
  for (const python of ['python', 'python3']) {
    const corrida = spawnSync(python, ['-c', codigo, XSD], { input: xml, encoding: 'utf8' });
    if (corrida.error || corrida.status === 3) continue;
    return corrida.status === 0 ? null : corrida.stdout.trim() || corrida.stderr.trim() || 'no valida';
  }
  return 'sin-validador';
}

describe('GET /v1/prices/variation (T-22, integración, requiere stack)', () => {
  let analista: string;
  let proveedor: string;
  let investigador: string;
  let presentaciones: PresentacionPropia[];
  let presentacion: string;
  let otraPresentacion: string;
  let sinPrecios: string;
  /** Tres tiendas: A y B en la misma zona; C en la misma zona, sin precio en la primera fecha. */
  let A: { id: string; zona_id: string };
  let B: { id: string; zona_id: string };
  let C: { id: string; zona_id: string };
  const creadas: string[] = [];

  const precio = (pres: string, tienda: string, importe: number, desde: string, hasta: string | null) =>
    db.query(
      'INSERT INTO precios (presentacion_id, tienda_id, precio, fecha_vigencia_desde, fecha_vigencia_hasta) VALUES ($1, $2, $3, $4, $5)',
      [pres, tienda, importe, desde, hasta],
    );

  const ruta = (extra = '', pres = presentacion) =>
    `/v1/prices/variation?presentationId=${pres}&dateFrom=2026-09-01&dateTo=2026-10-01${extra}`;

  beforeAll(async () => {
    await db.connect();
    analista = await sesion('it-var-analista', 'Analista comercial');
    proveedor = await sesion('it-var-proveedor', 'Proveedor');
    investigador = await sesion('it-var-campo', 'Investigador de mercado');
    presentaciones = await crearPresentaciones(db, 'variacion', 3);
    [presentacion, otraPresentacion, sinPrecios] = presentaciones.map((p) => p.presentacion_id);

    // Tres tiendas PROPIAS en la zona de una tienda del seed: así el resultado no depende de cuántas tiendas haya.
    const base = (await db.query('SELECT zona_id, direccion_id, formato FROM tiendas ORDER BY id LIMIT 1')).rows[0];
    for (const nombre of ['A', 'B', 'C']) {
      const direccion = await db.query(
        `INSERT INTO direcciones (calle, codigo_postal) SELECT 'IT variación ' || $1, codigo_postal FROM direcciones WHERE id = $2 RETURNING id`,
        [nombre, base.direccion_id],
      );
      const tienda = await db.query(
        'INSERT INTO tiendas (nombre, formato, direccion_id, zona_id) VALUES ($1, $2, $3, $4) RETURNING id, zona_id',
        [`IT variación ${nombre}`, base.formato, direccion.rows[0].id, base.zona_id],
      );
      creadas.push(tienda.rows[0].id);
      if (nombre === 'A') A = tienda.rows[0];
      if (nombre === 'B') B = tienda.rows[0];
      if (nombre === 'C') C = tienda.rows[0];
    }

    // CASO DE CONTROL del contrato. A: 20 → 22 (cambió el 15-sep). B: 30 → 27. C: abre el 20-sep a 40.
    await precio(presentacion, A.id, 20, '2026-08-01', '2026-09-14');
    await precio(presentacion, A.id, 22, '2026-09-15', null);
    await precio(presentacion, B.id, 30, '2026-08-10', '2026-09-20');
    await precio(presentacion, B.id, 27, '2026-09-21', null);
    await precio(presentacion, C.id, 40, '2026-09-20', null);
    // Otra presentación del mismo producto, con otro precio: NO debe mezclarse (D-06).
    await precio(otraPresentacion, A.id, 500, '2026-08-01', '2026-09-14');
    await precio(otraPresentacion, A.id, 900, '2026-09-15', null);
  });

  afterAll(async () => {
    await borrarPresentaciones(db, presentaciones);
    const direcciones = await db.query('SELECT direccion_id FROM tiendas WHERE id = ANY($1::uuid[])', [creadas]);
    await db.query('DELETE FROM tiendas WHERE id = ANY($1::uuid[])', [creadas]);
    await db.query('DELETE FROM direcciones WHERE id = ANY($1::uuid[])', [direcciones.rows.map((d) => d.direccion_id)]);
    await db.end();
    await redis.quit();
  });

  it('sin token → 401; Proveedor e Investigador de mercado → 403', async () => {
    expect((await http(ruta())).estado).toBe(401);
    expect((await http(ruta(), proveedor)).estado).toBe(403);
    expect((await http(ruta(), investigador)).estado).toBe(403);
  });

  it('CASO DE CONTROL por tienda: A +2.00 (+10 %), B −3.00 (−10 %), C sin precio el 1-sep', async () => {
    const r = await http(ruta(), analista);
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ presentationId: presentacion, dateFrom: '2026-09-01', dateTo: '2026-10-01' });
    const tienda = (id: string) => r.cuerpo.byStore.find((t: { storeId: string }) => t.storeId === id);
    expect(tienda(A.id)).toMatchObject({ disponible: true, priceFrom: 20, priceTo: 22, change: 2, changePercent: 10, motivo: null });
    expect(tienda(B.id)).toMatchObject({ disponible: true, priceFrom: 30, priceTo: 27, change: -3, changePercent: -10 });
    expect(tienda(C.id)).toMatchObject({
      disponible: false,
      priceFrom: null,
      priceTo: 40,
      change: null,
      changePercent: null,
      motivo: 'La tienda no tenía precio de esta presentación el 2026-09-01.',
    });
    expect(r.cuerpo.byStore).toHaveLength(3);
  });

  it('CASO DE CONTROL por zona: promedia solo A y B → 25.00 → 24.50, −0.50, −2 %', async () => {
    const r = await http(ruta(), analista);
    expect(r.cuerpo.byZone).toEqual([
      expect.objectContaining({
        zoneId: A.zona_id,
        stores: 3,
        comparableStores: 2,
        disponible: true,
        averageFrom: 25,
        averageTo: 24.5,
        change: -0.5,
        changePercent: -2,
        motivo: null,
      }),
    ]);
  });

  it('no mezcla presentaciones (D-06): la otra presentación del mismo producto da SU variación', async () => {
    const r = await http(ruta('', otraPresentacion), analista);
    expect(r.cuerpo.byStore).toEqual([expect.objectContaining({ storeId: A.id, priceFrom: 500, priceTo: 900, change: 400, changePercent: 80 })]);
    expect(r.cuerpo.byZone[0]).toMatchObject({ averageFrom: 500, averageTo: 900, comparableStores: 1 });
  });

  it('filtra por tienda y por zona', async () => {
    const soloB = await http(ruta(`&storeId=${B.id}`), analista);
    expect(soloB.cuerpo.byStore.map((t: { storeId: string }) => t.storeId)).toEqual([B.id]);
    expect(soloB.cuerpo.byZone[0]).toMatchObject({ stores: 1, comparableStores: 1, change: -3, changePercent: -10 });
    const otraZona = await http(ruta('&zoneId=00000000-0000-4000-8000-000000000000'), analista);
    expect(otraZona.cuerpo).toMatchObject({ byStore: [], byZone: [] });
  });

  it('el precio de una fecha es el del histórico que la cubre, no el vigente de hoy', async () => {
    // Entre el 10 y el 14 de septiembre A seguía en 20 y B en 30: sin cambio.
    const r = await http(`/v1/prices/variation?presentationId=${presentacion}&dateFrom=2026-09-10&dateTo=2026-09-14&storeId=${A.id}`, analista);
    expect(r.cuerpo.byStore[0]).toMatchObject({ priceFrom: 20, priceTo: 20, change: 0, changePercent: 0, disponible: true });
    // Antes de que nadie tuviera precio: no disponible, nunca 0.
    const antes = await http(`/v1/prices/variation?presentationId=${presentacion}&dateFrom=2026-01-01&dateTo=2026-01-31`, analista);
    expect(antes.cuerpo.byStore.every((t: { disponible: boolean; change: null }) => !t.disponible && t.change === null)).toBe(true);
    expect(antes.cuerpo.byZone[0]).toMatchObject({ disponible: false, comparableStores: 0, averageFrom: null, change: null });
  });

  it('una presentación sin precios responde 200 con listas vacías', async () => {
    const r = await http(ruta('', sinPrecios), analista);
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ byStore: [], byZone: [] });
  });

  it('validaciones → 400: faltan fechas, fecha inexistente, rango invertido, ids mal formados, presentación inexistente', async () => {
    const base = `/v1/prices/variation?presentationId=${presentacion}`;
    expect((await http(base, analista)).estado).toBe(400);
    expect((await http(`${base}&dateFrom=2026-09-01`, analista)).estado).toBe(400);
    expect((await http(`${base}&dateFrom=2026-02-30&dateTo=2026-03-01`, analista)).estado).toBe(400);
    expect((await http(`${base}&dateFrom=2026-10-01&dateTo=2026-09-01`, analista)).estado).toBe(400);
    expect((await http(ruta('&storeId=tienda-1'), analista)).estado).toBe(400);
    expect((await http(ruta('&orden=asc'), analista)).estado).toBe(400);
    expect((await http('/v1/prices/variation?presentationId=abc&dateFrom=2026-09-01&dateTo=2026-10-01', analista)).estado).toBe(400);
    const fantasma = await http(ruta('', '00000000-0000-4000-8000-000000000000'), analista);
    expect(fantasma.estado).toBe(400);
    expect(fantasma.cuerpo.code).toBe('VALIDATION_ERROR');
  });

  it('el XML valida contra el XSD: con datos, con una tienda no disponible y vacío', async () => {
    for (const url of [ruta(), ruta('', sinPrecios), `/v1/prices/variation?presentationId=${presentacion}&dateFrom=2026-01-01&dateTo=2026-01-31`]) {
      const r = await http(url, analista, 'application/xml');
      expect(r.estado).toBe(200);
      expect(r.texto).toContain('<priceVariationResponse xmlns="pricing/v1"');
      const error = errorDeXsd(r.texto);
      if (error === 'sin-validador') {
        console.warn('Sin Python + lxml: no se validó el XML contra el XSD.');
        continue;
      }
      expect(error).toBeNull();
    }
  });
});
