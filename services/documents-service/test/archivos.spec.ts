/**
 * Integración del flujo de archivos privados: reporte guardado → archivo en el
 * almacén → URL firmada → descarga, con MongoDB y Redis REALES y el servicio
 * corriendo en proceso (misma configuración que main.ts) sobre el doble local
 * del almacén. notifications-service y audit-service se sustituyen por un
 * servidor HTTP falso que registra lo que recibe.
 *
 *   docker compose -f infra/docker-compose.yml up -d mongodb redis
 *   npm run test:integracion -- archivos
 *
 * Cubre: dueño y recurso ajeno (404), rol sin permiso (403), idempotencia y
 * concurrencia, aviso único, almacén caído (503 + fallido) y recuperación,
 * objeto borrado (nunca se anuncia como disponible), hash de la descarga,
 * firma alterada y vencida, X-Correlation-Id y XML contra el XSD.
 */
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { createServer, IncomingMessage, Server } from 'http';
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import mongoose from 'mongoose';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { INestApplication } from '@nestjs/common';

const SECRET = 'secreto-it-archivos';
const MONGO = process.env.MONGO_URL ?? 'mongodb://retail_admin:retail_pass_2026@localhost:27017/retaildb?authSource=admin';
const XSD = path.join(__dirname, '..', '..', '..', 'docs', 'contratos', 'documents-service.xsd');
const PREFIJO = 'it-arch-';

interface Recibido {
  ruta: string;
  cuerpo: Record<string, unknown>;
  correlacion: string | undefined;
}

let app: INestApplication;
let BASE: string;
let falso: Server;
let carpeta: string;
const recibidos: Recibido[] = [];
let notificacionesAceptan = true;
const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: parseInt(process.env.REDIS_PORT ?? '6379', 10) });

async function puertoLibre(): Promise<number> {
  const s = createServer();
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const { port } = s.address() as AddressInfo;
  await new Promise((ok) => s.close(ok));
  return port;
}

async function leerCuerpo(req: IncomingMessage): Promise<string> {
  let texto = '';
  for await (const parte of req) texto += parte;
  return texto;
}

async function sesion(userId: string, rol: string): Promise<string> {
  await redis.set(`session:${userId}`, '1', 'EX', 900);
  return sign({ sub: userId, email: `${userId}@test`, rol, rolId: 1, jti: `jti-${userId}` }, SECRET, { expiresIn: '15m' });
}

async function http(metodo: string, ruta: string, token?: string, cuerpo?: object, extra: Record<string, string> = {}) {
  const r = await fetch(ruta.startsWith('http') ? ruta : `${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const bytes = Buffer.from(await r.arrayBuffer());
  const texto = bytes.toString('utf8');
  let json: any = null;
  try { json = JSON.parse(texto); } catch { /* binario o XML */ }
  return { estado: r.status, cuerpo: json, texto, bytes, cabeceras: r.headers };
}

function errorDeXsd(xml: string): string | null {
  for (const python of ['python', 'python3']) {
    const c = spawnSync(python, [path.join(__dirname, 'validar_xsd.py'), XSD], { input: xml, encoding: 'utf8' });
    if (c.error || c.status === 3) continue;
    return c.status === 0 ? null : c.stdout.trim() || c.stderr.trim() || 'no valida';
  }
  return 'sin-validador';
}

function avisos(recursoId: string) {
  return recibidos.filter((r) => r.ruta === '/v1/notifications' && r.cuerpo.relatedEntityId === recursoId);
}

async function insertarReporte(usuarioId: string): Promise<string> {
  const id = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('reportes').insertOne({
    _id: id,
    tipo: 'ejecutivo',
    parametros: { dateFrom: '2026-08-01', dateTo: '2026-08-31', zoneId: null, segmentId: null },
    formato: 'json',
    usuarioId,
    estado: 'generado',
    creadoEn: new Date('2026-08-31T12:00:00Z'),
    secciones: [
      { clave: 'ticket_promedio', nombre: 'Ticket promedio', servicio: 'core-process-service', disponible: true, valor: 86.4, motivo: null },
      { clave: 'elasticidad_promedio', nombre: 'Elasticidad promedio', servicio: 'algorithms-core', disponible: false, valor: null, motivo: 'algorithms-core no respondió en 3 s.' },
    ],
  });
  return String(id);
}

describe('Archivos privados de reportes (integración, requiere MongoDB y Redis)', () => {
  let gerente: string;
  let auditor: string;
  let provA: string;
  let provB: string;
  let investigador: string;
  let repGerente: string;
  let repProvA: string;

  beforeAll(async () => {
    // Servidor falso de notifications y audit: registra cuerpo y X-Correlation-Id.
    falso = createServer(async (req, res) => {
      const cuerpo = JSON.parse((await leerCuerpo(req)) || '{}');
      recibidos.push({ ruta: req.url ?? '', cuerpo, correlacion: req.headers['x-correlation-id'] as string | undefined });
      const acepta = req.url !== '/v1/notifications' || notificacionesAceptan;
      res.writeHead(acepta ? 201 : 400, { 'Content-Type': 'application/json' }).end('{}');
    });
    await new Promise<void>((ok) => falso.listen(0, '127.0.0.1', ok));
    const urlFalso = `http://127.0.0.1:${(falso.address() as AddressInfo).port}`;

    const puerto = await puertoLibre();
    BASE = `http://127.0.0.1:${puerto}`;
    carpeta = await fs.mkdtemp(path.join(os.tmpdir(), 'it-archivos-'));
    Object.assign(process.env, {
      JWT_ACCESS_SECRET: SECRET,
      MONGO_URL: MONGO,
      XML_NAMESPACE: 'documents/v1',
      SERVICE_NAME: 'documents-service',
      ARCHIVOS_ALMACEN: 'local',
      ARCHIVOS_DIR_LOCAL: carpeta,
      ARCHIVOS_FIRMA_LOCAL_SECRET: 'firma-it',
      ARCHIVOS_URL_BASE_PUBLICA: BASE,
      NOTIFICATIONS_SERVICE_URL: urlFalso,
      AUDIT_SERVICE_URL: urlFalso,
    });
    delete process.env.ARCHIVOS_LOCAL_CAIDO;
    delete process.env.ARCHIVOS_URL_TTL_SEGUNDOS;

    // Se importan DESPUÉS de fijar el entorno: el almacén se crea al iniciar el módulo.
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../src/app.module');
    const { configurarApp } = await import('../src/app.setup');
    app = await NestFactory.create(AppModule, { logger: ['error'] });
    configurarApp(app);
    await app.listen(puerto, '127.0.0.1');

    await mongoose.connect(MONGO);
    gerente = await sesion(`${PREFIJO}ger`, 'Gerente de categoría');
    auditor = await sesion(`${PREFIJO}aud`, 'Auditor');
    provA = await sesion(`${PREFIJO}prov-a`, 'Proveedor');
    provB = await sesion(`${PREFIJO}prov-b`, 'Proveedor');
    investigador = await sesion(`${PREFIJO}inv`, 'Investigador de mercado');
    repGerente = await insertarReporte(`${PREFIJO}ger`);
    repProvA = await insertarReporte(`${PREFIJO}prov-a`);
  });

  afterAll(async () => {
    const ids = [repGerente, repProvA].filter(Boolean);
    await mongoose.connection.collection('archivos').deleteMany({ recursoId: { $in: ids } });
    await mongoose.connection.collection('reportes').deleteMany({ usuarioId: { $regex: `^${PREFIJO}` } });
    await mongoose.disconnect();
    await app?.close();
    // El guard abre su propio cliente de Redis (singleton): si no se cierra, Jest no termina.
    (await import('../src/common/auth/redis.client')).getRedis().disconnect();
    await redis.quit();
    await new Promise((ok) => falso.close(ok));
    await fs.rm(carpeta, { recursive: true, force: true });
  });

  it('sin sesión 401; un rol fuera de la Matriz (Investigador) 403', async () => {
    expect((await http('POST', `/v1/reports/${repGerente}/files`, undefined, { format: 'pdf' })).estado).toBe(401);
    expect((await http('POST', `/v1/reports/${repGerente}/files`, investigador, { format: 'pdf' })).estado).toBe(403);
  });

  it('formato inválido 400 y reporte con id mal formado 400', async () => {
    expect((await http('POST', `/v1/reports/${repGerente}/files`, gerente, { format: 'docx' })).estado).toBe(400);
    expect((await http('POST', `/v1/reports/no-es-id/files`, gerente, { format: 'pdf' })).estado).toBe(400);
  });

  let pdfId: string;

  it('el Gerente genera el PDF: 201, disponible, con hash y tamaño, y una ruta que no es nombre del usuario', async () => {
    const correlacion = `it-corr-${randomUUID()}`;
    const r = await http('POST', `/v1/reports/${repGerente}/files`, gerente, { format: 'pdf' }, { 'X-Correlation-Id': correlacion });
    expect(r.estado).toBe(201);
    expect(r.cuerpo).toMatchObject({ estado: 'disponible', formato: 'pdf', recursoId: repGerente, privacidad: 'privado', almacen: 'local', bucket: 'local', intentos: 1 });
    expect(r.cuerpo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.cuerpo.tamanoBytes).toBeGreaterThan(500);
    expect(r.cuerpo.ruta).toBe(`reportes/2026/08/${repGerente}/${r.cuerpo.id}-1.pdf`);
    expect(r.cuerpo.correlationId).toBe(correlacion);
    expect(r.cuerpo.metadatos.indicadoresNoDisponibles).toBe(1);
    expect(r.cuerpo).not.toHaveProperty('url');
    pdfId = r.cuerpo.id;

    // El objeto existe con ese tamaño: el registro no anuncia algo que no está.
    expect((await fs.stat(path.join(carpeta, r.cuerpo.ruta))).size).toBe(r.cuerpo.tamanoBytes);
    // Un aviso al que lo pidió, con el mismo id de correlación; y su registro en la bitácora.
    const a = avisos(repGerente);
    expect(a).toHaveLength(1);
    expect(a[0].cuerpo).toMatchObject({ eventType: 'reporte.generado', recipientUserId: `${PREFIJO}ger`, sourceService: 'documents-service' });
    expect(a[0].correlacion).toBe(correlacion);
    const bit = recibidos.find((x) => x.ruta === '/v1/auditoria' && x.cuerpo.registroId === pdfId && x.cuerpo.accion === 'insert');
    expect(bit?.correlacion).toBe(correlacion);
  });

  it('repetir la petición: 200, mismo archivo, sin subir otro objeto ni repetir el aviso', async () => {
    const r = await http('POST', `/v1/reports/${repGerente}/files`, gerente, { format: 'pdf' });
    expect(r.estado).toBe(200);
    expect(r.cuerpo.id).toBe(pdfId);
    expect(r.cuerpo.intentos).toBe(1);
    expect(avisos(repGerente)).toHaveLength(1);
    expect(await fs.readdir(path.join(carpeta, 'reportes/2026/08', repGerente))).toHaveLength(1);
  });

  it('peticiones simultáneas del mismo formato: un solo registro y un solo objeto', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, () => http('POST', `/v1/reports/${repGerente}/files`, gerente, { format: 'csv' })));
    expect(rs.filter((r) => r.estado === 201)).toHaveLength(1);
    expect(rs.every((r) => [200, 201, 202].includes(r.estado))).toBe(true);
    expect(new Set(rs.map((r) => r.cuerpo.id)).size).toBe(1);
    expect(await mongoose.connection.collection('archivos').countDocuments({ recursoId: repGerente, formato: 'csv' })).toBe(1);
    const csvs = (await fs.readdir(path.join(carpeta, 'reportes/2026/08', repGerente))).filter((f) => f.endsWith('.csv'));
    expect(csvs).toHaveLength(1);
  });

  it('URL firmada: autoriza, firma por 5 min, la descarga trae el hash correcto y cuenta la lectura', async () => {
    const u = await http('POST', `/v1/reports/${repGerente}/files/${pdfId}/download-url`, auditor);
    expect(u.estado).toBe(200);
    expect(u.cuerpo.ttlSegundos).toBe(300);
    expect(new Date(u.cuerpo.expiraEn).getTime() - Date.now()).toBeGreaterThan(290_000);
    expect(u.cuerpo.nombre).toBe('reporte-ejecutivo-2026-08-31.pdf');

    const d = await http('GET', u.cuerpo.url);
    expect(d.estado).toBe(200);
    expect(d.cabeceras.get('content-type')).toBe('application/pdf');
    expect(d.cabeceras.get('content-disposition')).toContain('reporte-ejecutivo-2026-08-31.pdf');
    expect(createHash('sha256').update(d.bytes).digest('hex')).toBe(u.cuerpo.sha256);

    const reg = await http('GET', `/v1/reports/${repGerente}/files/${pdfId}`, gerente);
    expect(reg.cuerpo).toMatchObject({ urlsEmitidas: 1, lecturas: 1 });
    // La bitácora registra la EMISIÓN, sin la URL.
    const emision = recibidos.find((x) => x.ruta === '/v1/auditoria' && x.cuerpo.registroId === pdfId && x.cuerpo.accion === 'exportar');
    expect(emision).toBeDefined();
    expect(JSON.stringify(emision!.cuerpo)).not.toContain('sig=');
  });

  it('firma alterada, de otro archivo o vencida: 404 sin confirmar que exista', async () => {
    const u = await http('POST', `/v1/reports/${repGerente}/files/${pdfId}/download-url`, gerente);
    const url = new URL(u.cuerpo.url);
    const sig = url.searchParams.get('sig')!;
    url.searchParams.set('sig', (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1));
    expect((await http('GET', url.toString())).estado).toBe(404);
    expect((await http('GET', u.cuerpo.url.replace(pdfId, randomUUID()))).estado).toBe(404);

    process.env.ARCHIVOS_URL_TTL_SEGUNDOS = '1';
    const corta = await http('POST', `/v1/reports/${repGerente}/files/${pdfId}/download-url`, gerente);
    delete process.env.ARCHIVOS_URL_TTL_SEGUNDOS;
    expect(corta.cuerpo.ttlSegundos).toBe(1);
    await new Promise((ok) => setTimeout(ok, 2100));
    expect((await http('GET', corta.cuerpo.url)).estado).toBe(404);
  });

  it('Proveedor: el reporte ajeno es 404 en todo; el propio sí lo genera y lo descarga', async () => {
    expect((await http('POST', `/v1/reports/${repGerente}/files`, provA, { format: 'pdf' })).estado).toBe(404);
    expect((await http('GET', `/v1/reports/${repGerente}/files`, provA)).estado).toBe(404);
    expect((await http('GET', `/v1/reports/${repGerente}/files/${pdfId}`, provA)).estado).toBe(404);
    expect((await http('POST', `/v1/reports/${repGerente}/files/${pdfId}/download-url`, provA)).estado).toBe(404);

    const propio = await http('POST', `/v1/reports/${repProvA}/files`, provA, { format: 'csv' });
    expect(propio.estado).toBe(201);
    expect(propio.cuerpo.propietarioId).toBe(`${PREFIJO}prov-a`);
    // Otro Proveedor no lo ve.
    expect((await http('POST', `/v1/reports/${repProvA}/files/${propio.cuerpo.id}/download-url`, provB)).estado).toBe(404);
    // Un archivo de otro reporte con el id de reporte propio tampoco.
    expect((await http('POST', `/v1/reports/${repProvA}/files/${pdfId}/download-url`, provA)).estado).toBe(404);
    const u = await http('POST', `/v1/reports/${repProvA}/files/${propio.cuerpo.id}/download-url`, provA);
    expect(u.estado).toBe(200);
  });

  it('almacén caído: 503 controlado, registro fallido, sin aviso; al volver, el reintento lo deja disponible con un solo aviso', async () => {
    process.env.ARCHIVOS_LOCAL_CAIDO = 'true';
    const caido = await http('POST', `/v1/reports/${repGerente}/files`, gerente, { format: 'xlsx' });
    expect(caido.estado).toBe(503);
    expect(caido.cuerpo.code).toBe('SERVICE_UNAVAILABLE');
    const lista = await http('GET', `/v1/reports/${repGerente}/files`, gerente);
    const xlsx = lista.cuerpo.data.find((a: any) => a.formato === 'xlsx');
    expect(xlsx).toMatchObject({ estado: 'fallido', intentos: 1, tamanoBytes: null, sha256: null });
    expect(xlsx.ultimoError).toContain('caído');
    expect((await http('POST', `/v1/reports/${repGerente}/files/${xlsx.id}/download-url`, gerente)).estado).toBe(409);
    const health = await http('GET', '/v1/health');
    expect(health.cuerpo.status).toBe('degraded');
    const avisosAntes = avisos(repGerente).length;

    delete process.env.ARCHIVOS_LOCAL_CAIDO;
    const ok = await http('POST', `/v1/reports/${repGerente}/files`, gerente, { format: 'xlsx' });
    expect(ok.estado).toBe(201);
    expect(ok.cuerpo).toMatchObject({ id: xlsx.id, estado: 'disponible', intentos: 2, ultimoError: null });
    expect(ok.cuerpo.ruta).toMatch(/-2\.xlsx$/);
    expect(avisos(repGerente).length).toBe(avisosAntes + 1);
    expect((await http('POST', `/v1/reports/${repGerente}/files`, gerente, { format: 'xlsx' })).estado).toBe(200);
    expect(avisos(repGerente).length).toBe(avisosAntes + 1);
  });

  it('si el objeto desaparece del almacén, el registro deja de anunciarlo y se regenera', async () => {
    const reg = await http('GET', `/v1/reports/${repGerente}/files/${pdfId}`, gerente);
    await fs.rm(path.join(carpeta, reg.cuerpo.ruta));
    expect((await http('POST', `/v1/reports/${repGerente}/files/${pdfId}/download-url`, gerente)).estado).toBe(409);
    expect((await http('GET', `/v1/reports/${repGerente}/files/${pdfId}`, gerente)).cuerpo.estado).toBe('fallido');
    const re = await http('POST', `/v1/reports/${repGerente}/files`, gerente, { format: 'pdf' });
    expect(re.estado).toBe(201);
    expect(re.cuerpo).toMatchObject({ id: pdfId, estado: 'disponible', intentos: 2 });
    // El aviso ya se había dado para este archivo: regenerarlo no avisa otra vez.
    expect(avisos(repGerente).filter((a) => String(a.cuerpo.message).includes('PDF'))).toHaveLength(1);
  });

  it('reporte.generado solo lo origina el Gerente (T-20): el archivo de otro perfil no emite aviso', async () => {
    expect(avisos(repProvA)).toHaveLength(0);
  });

  it('si notifications rechaza el aviso, no se marca como dado y la siguiente petición lo reintenta una vez', async () => {
    const rep = await insertarReporte(`${PREFIJO}ger`);
    notificacionesAceptan = false;
    const r1 = await http('POST', `/v1/reports/${rep}/files`, gerente, { format: 'pdf' });
    expect(r1.estado).toBe(201);
    expect(avisos(rep)).toHaveLength(1);
    notificacionesAceptan = true;
    expect((await http('POST', `/v1/reports/${rep}/files`, gerente, { format: 'pdf' })).estado).toBe(200);
    expect((await http('POST', `/v1/reports/${rep}/files`, gerente, { format: 'pdf' })).estado).toBe(200);
    expect(avisos(rep)).toHaveLength(2);
    await mongoose.connection.collection('archivos').deleteMany({ recursoId: rep });
  });

  it('XML: archivo, lista, URL firmada y error validan contra documents-service.xsd', async () => {
    const xml = { Accept: 'application/xml' };
    const casos = [
      await http('GET', `/v1/reports/${repGerente}/files/${pdfId}`, gerente, undefined, xml),
      await http('GET', `/v1/reports/${repGerente}/files`, gerente, undefined, xml),
      await http('POST', `/v1/reports/${repGerente}/files/${pdfId}/download-url`, gerente, undefined, xml),
      await http('GET', `/v1/reports/${repGerente}/files/${randomUUID()}`, gerente, undefined, xml),
    ];
    expect(casos.map((c) => c.estado)).toEqual([200, 200, 200, 404]);
    for (const c of casos) {
      const error = errorDeXsd(c.texto);
      if (error === 'sin-validador') {
        console.warn('Sin Python + lxml: no se validó el XML contra el XSD.');
        return;
      }
      expect(error).toBeNull();
    }
  });

  it('el health reporta el almacén (tipo y bucket, sin rutas físicas)', async () => {
    const h = await http('GET', '/v1/health');
    expect(h.cuerpo.almacen).toEqual({ tipo: 'local', bucket: 'local' });
    expect(Object.keys(h.cuerpo.checks)).toEqual(['redis', 'mongodb', 'bucket']);
  });
});
