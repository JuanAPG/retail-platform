/**
 * D-30: visitas de campo (ubicación RF-37 + encuesta RF-38) en MongoDB, contra el servicio real.
 *
 *   docker compose up -d postgres redis mongodb catalog-service   # catalog con MONGO_URL
 *   npm run test:integracion -- field-visits
 *
 * Usuarios del seed (id y nombre de rol reales). Valida el XML contra catalog-service.xsd
 * si hay Python con lxml.
 */
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import mongoose from 'mongoose';
import { join } from 'path';
import { Client } from 'pg';

const BASE = process.env.CATALOG_BASE_URL ?? 'http://localhost:3102';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';
const MONGO = process.env.MONGO_URL ?? 'mongodb://retail_admin:retail_pass_2026@localhost:27017/retaildb?authSource=admin';
const XSD = join(__dirname, '..', '..', '..', 'docs', 'contratos', 'catalog-service.xsd');

const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: parseInt(process.env.REDIS_PORT ?? '6379', 10) });
const db = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  user: process.env.DB_USER ?? 'retail_user',
  password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
  database: process.env.DB_NAME ?? 'retaildb',
});

async function sesionDelSeed(email: string) {
  const { rows } = await db.query<{ id: string; rol: string }>(
    'SELECT u.id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.email = $1',
    [email],
  );
  if (!rows[0]) throw new Error(`El seed no tiene ${email}`);
  await redis.set(`session:${rows[0].id}`, '1', 'EX', 600);
  return { token: sign({ sub: rows[0].id, email, rol: rows[0].rol, rolId: 1, jti: `jti-${rows[0].id}` }, SECRET, { expiresIn: '10m' }), id: rows[0].id };
}

async function http(metodo: string, ruta: string, token?: string, cuerpo?: object, extra: Record<string, string> = {}) {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  let json: any = null;
  try { json = JSON.parse(texto); } catch { /* XML */ }
  return { estado: r.status, cuerpo: json, texto, correlacion: r.headers.get('x-correlation-id') };
}

function errorDeXsd(xml: string): string | null {
  for (const python of ['python', 'python3']) {
    const c = spawnSync(python, ['-c', 'import sys\nfrom lxml import etree\ns=etree.XMLSchema(etree.parse(sys.argv[1]))\nd=etree.fromstring(sys.stdin.buffer.read())\nsys.exit(0 if s.validate(d) else (print(s.error_log) or 1))', XSD], { input: xml, encoding: 'utf8' });
    if (c.error || /No module named/.test(c.stderr ?? '')) continue;
    return c.status === 0 ? null : c.stdout.trim() || c.stderr.trim();
  }
  return 'sin-validador';
}

describe('Visitas de campo (D-30, integración, requiere stack + MongoDB)', () => {
  let investigador: { token: string; id: string };
  let otroInvestigador: string;
  let analista: string;
  let tiendaId: string;
  let zonaId: string;
  const creadas: string[] = [];

  const visita = (extra: object = {}) => ({
    visitId: randomUUID(),
    storeId: tiendaId,
    visitedAt: '2026-11-20T16:05:00Z',
    lat: 25.6866,
    lng: -100.3161,
    accuracyM: 12,
    answers: [
      { preguntaId: 'p-frescura', pregunta: '¿Los perecederos se ven frescos?', respuesta: 'si' },
      { preguntaId: 'p-cajas', pregunta: '¿Cuántas cajas abiertas?', respuesta: 3 },
      { preguntaId: 'p-limpio', pregunta: '¿Pasillo limpio?', respuesta: true },
    ],
    ...extra,
  });

  beforeAll(async () => {
    await db.connect();
    await mongoose.connect(MONGO);
    investigador = await sesionDelSeed('investigador@retail.mx');
    analista = (await sesionDelSeed('analista@retail.mx')).token;
    // Un segundo "investigador" con el mismo rol y otro id, para el caso de id ajeno.
    const { rows } = await db.query<{ rol: string }>("SELECT r.nombre AS rol FROM roles r WHERE r.nombre = 'Investigador de mercado'");
    const otroId = randomUUID();
    await redis.set(`session:${otroId}`, '1', 'EX', 600);
    otroInvestigador = sign({ sub: otroId, email: 'otro@test', rol: rows[0].rol, rolId: 1, jti: `jti-${otroId}` }, SECRET, { expiresIn: '10m' });
    const t = await db.query<{ id: string; zona_id: string }>('SELECT id, zona_id FROM tiendas WHERE activo = true ORDER BY id LIMIT 1');
    tiendaId = t.rows[0].id;
    zonaId = t.rows[0].zona_id;
  });

  afterAll(async () => {
    await mongoose.connection.collection('visitas_campo').deleteMany({ _id: { $in: creadas } as never });
    await mongoose.disconnect();
    await db.end();
    await redis.quit();
  });

  it('el health reporta MongoDB', async () => {
    const h = await http('GET', '/v1/health');
    expect(h.cuerpo.checks.mongodb).toBe('ok');
  });

  it('sin sesión 401; un rol sin alta de visitas (Analista) 403', async () => {
    expect((await http('POST', '/v1/field-visits', undefined, visita())).estado).toBe(401);
    expect((await http('POST', '/v1/field-visits', analista, visita())).estado).toBe(403);
  });

  it('el Investigador registra: 201, con ubicación, encuesta, zona de la tienda y correlación; queda en visitas_campo', async () => {
    const v = visita();
    creadas.push(v.visitId);
    const r = await http('POST', '/v1/field-visits', investigador.token, v, { 'X-Correlation-Id': `it-visita-${v.visitId}` });
    expect(r.estado).toBe(201);
    expect(r.cuerpo).toMatchObject({ visitId: v.visitId, storeId: tiendaId, zoneId: zonaId, lat: 25.6866, lng: -100.3161, capturedBy: investigador.id });
    expect(r.cuerpo.answers).toHaveLength(3);
    expect(r.correlacion).toBe(`it-visita-${v.visitId}`);
    const doc = await mongoose.connection.collection('visitas_campo').findOne({ _id: v.visitId as never });
    expect(doc?.ubicacion).toEqual({ type: 'Point', coordinates: [-100.3161, 25.6866] });
    expect(doc?.correlationId).toBe(`it-visita-${v.visitId}`);
  });

  it('reenvío del mismo visitId (también en paralelo): 200 con la original y una sola fila', async () => {
    const v = visita();
    creadas.push(v.visitId);
    expect((await http('POST', '/v1/field-visits', investigador.token, v)).estado).toBe(201);
    const rs = await Promise.all([1, 2, 3].map(() => http('POST', '/v1/field-visits', investigador.token, { ...v, notes: 'cambiado' })));
    expect(rs.map((r) => r.estado)).toEqual([200, 200, 200]);
    expect(rs.every((r) => r.cuerpo.notes === null)).toBe(true); // la original, no la reenviada
    expect(await mongoose.connection.collection('visitas_campo').countDocuments({ _id: v.visitId as never })).toBe(1);
  });

  it('el mismo visitId de otro usuario: 409 sin revelar la visita', async () => {
    const v = visita();
    creadas.push(v.visitId);
    await http('POST', '/v1/field-visits', investigador.token, v);
    const r = await http('POST', '/v1/field-visits', otroInvestigador, v);
    expect(r.estado).toBe(409);
    expect(r.texto).not.toContain(tiendaId);
  });

  it('valida: sin GPS, coordenadas fuera de rango, fecha futura, tienda inexistente, respuesta como objeto, campos extra', async () => {
    const malos = [
      visita({ lat: undefined }),
      visita({ lat: 95 }),
      visita({ lng: -181 }),
      visita({ visitId: 'no-uuid' }),
      visita({ visitedAt: new Date(Date.now() + 3600_000).toISOString() }),
      visita({ storeId: randomUUID() }),
      visita({ answers: [{ preguntaId: 'p', pregunta: 'x', respuesta: { a: 1 } }] }),
      visita({ answers: [{ preguntaId: 'con espacios', pregunta: 'x', respuesta: 'y' }] }),
      visita({ capturedBy: 'yo' }),
    ];
    for (const m of malos) {
      const r = await http('POST', '/v1/field-visits', investigador.token, m);
      expect([400, r.cuerpo?.message]).toEqual([r.estado, r.cuerpo?.message]);
    }
  });

  it('D-52: leen Analista, Administrador y Auditor; Investigador y otros perfiles 403; inexistente 404', async () => {
    const v = visita();
    creadas.push(v.visitId);
    expect((await http('POST', '/v1/field-visits', investigador.token, v)).estado).toBe(201);
    const admin = (await sesionDelSeed('admin@retail.mx')).token;
    const auditor = (await sesionDelSeed('auditor@retail.mx')).token;
    const gerente = (await sesionDelSeed('gercategoria@retail.mx')).token;
    for (const token of [analista, admin, auditor]) {
      const lista = await http('GET', `/v1/field-visits?storeId=${tiendaId}&dateFrom=2026-11-20&dateTo=2026-11-20&limit=100`, token);
      expect(lista.estado).toBe(200);
      expect(lista.cuerpo.data.map((x: { visitId: string }) => x.visitId)).toContain(v.visitId);
      expect((await http('GET', `/v1/field-visits/${v.visitId}`, token)).cuerpo.visitId).toBe(v.visitId);
    }
    for (const token of [investigador.token, gerente]) {
      expect((await http('GET', '/v1/field-visits', token)).estado).toBe(403);
    }
    expect((await http('GET', `/v1/field-visits/${randomUUID()}`, analista)).estado).toBe(404);
    expect((await http('GET', '/v1/field-visits?dateFrom=2026-11-21&dateTo=2026-11-20', analista)).estado).toBe(400);
    const fuera = await http('GET', `/v1/field-visits?storeId=${tiendaId}&dateFrom=2026-12-01`, analista);
    expect(fuera.cuerpo.data.map((x: { visitId: string }) => x.visitId)).not.toContain(v.visitId);
  });

  it('XML: la respuesta valida contra catalog-service.xsd', async () => {
    const v = visita();
    creadas.push(v.visitId);
    const r = await http('POST', '/v1/field-visits', investigador.token, v, { Accept: 'application/xml' });
    expect(r.estado).toBe(201);
    const error = errorDeXsd(r.texto);
    if (error === 'sin-validador') return console.warn('Sin Python + lxml: no se validó el XML.');
    expect(error).toBeNull();
  });
});
