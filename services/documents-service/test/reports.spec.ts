/**
 * Integración de /v1/reports contra el servicio real y MongoDB real. Requisitos:
 *
 *   docker compose -f infra/docker-compose.yml up -d mongodb redis documents-service catalog-service
 *   npm run test:integracion
 *
 * Los demás servicios (core-process, algorithms-core, decision, pricing) pueden estar
 * apagados: justo eso demuestra la regla de D-20 (indicador no disponible, nunca 0).
 */
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import mongoose from 'mongoose';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');
import * as ExcelJS from 'exceljs';

const BASE = process.env.DOCUMENTS_BASE_URL ?? 'http://localhost:3108';
const CATALOG = process.env.CATALOG_BASE_URL ?? 'http://localhost:3102';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';
const MONGO = process.env.MONGO_URL ?? 'mongodb://retail_admin:retail_pass_2026@localhost:27017/retaildb?authSource=admin';

const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: parseInt(process.env.REDIS_PORT ?? '6379', 10) });
const PREFIJO = 'it-doc-';

async function sesion(userId: string, rol: string): Promise<string> {
  await redis.set(`session:${userId}`, '1', 'EX', 900);
  return sign({ sub: userId, email: `${userId}@test`, rol, rolId: 1, jti: `jti-${userId}` }, SECRET, { expiresIn: '15m' });
}

async function http(metodo: string, ruta: string, token?: string, cuerpo?: object, accept?: string, base = BASE) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(accept ? { Accept: accept } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  let json: any = null;
  try { json = JSON.parse(texto); } catch { /* XML o binario */ }
  return { estado: r.status, cuerpo: json, texto, cabeceras: r.headers };
}

const PERIODO = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };

describe('/v1/reports (integración, requiere stack + MongoDB)', () => {
  let gerente: string;
  let admin: string;
  let analista: string;
  let auditor: string;
  let provA: string;
  let provB: string;
  let reporteId: string;
  let reporte: any;

  beforeAll(async () => {
    gerente = await sesion(`${PREFIJO}ger`, 'Gerente de categoría');
    admin = await sesion(`${PREFIJO}admin`, 'Administrador');
    analista = await sesion(`${PREFIJO}analista`, 'Analista comercial');
    auditor = await sesion(`${PREFIJO}auditor`, 'Auditor');
    provA = await sesion(`${PREFIJO}prov-a`, 'Proveedor');
    provB = await sesion(`${PREFIJO}prov-b`, 'Proveedor');
    await mongoose.connect(MONGO);
  });

  afterAll(async () => {
    await mongoose.connection.collection('reportes').deleteMany({ usuarioId: { $regex: `^${PREFIJO}` } });
    await mongoose.disconnect();
    await redis.quit();
  });

  it('sin token 401; solo el Gerente genera (403 al resto, incluido Administrador y Proveedor)', async () => {
    expect((await http('POST', '/v1/reports/executive', undefined, PERIODO)).estado).toBe(401);
    for (const token of [admin, analista, auditor, provA]) {
      expect((await http('POST', '/v1/reports/executive', token, PERIODO)).estado).toBe(403);
    }
  });

  it('valida el cuerpo: fechas mal formadas, rango invertido y campos extra (400)', async () => {
    for (const malo of [
      {},
      { dateFrom: '01/08/2026', dateTo: '2026-08-31' },
      { dateFrom: '2026-09-01', dateTo: '2026-08-31' },
      { ...PERIODO, zoneId: 'no-uuid' },
      { ...PERIODO, extra: 1 },
    ]) {
      expect((await http('POST', '/v1/reports/executive', gerente, malo)).estado).toBe(400);
    }
  });

  it('DOC-01: genera el reporte con los 16 indicadores; los de un servicio apagado salen NO disponibles, nunca 0', async () => {
    const r = await http('POST', '/v1/reports/executive', gerente, PERIODO);
    expect(r.estado).toBe(201);
    reporte = r.cuerpo;
    reporteId = r.cuerpo.id;

    expect(reporte).toMatchObject({ tipo: 'ejecutivo', estado: 'generado', usuarioId: `${PREFIJO}ger`, parametros: { ...PERIODO, zoneId: null, segmentId: null } });
    expect(reporte.secciones).toHaveLength(16);
    for (const s of reporte.secciones) {
      if (s.disponible) {
        expect(s.motivo).toBeNull();
      } else {
        expect(s.valor).toBeNull();
        expect(typeof s.motivo).toBe('string');
        expect(s.motivo.length).toBeGreaterThan(5);
      }
    }
    // Ningún indicador no disponible se disfraza de 0.
    expect(reporte.secciones.filter((s: any) => !s.disponible).every((s: any) => s.valor !== 0)).toBe(true);
  });

  it('DOC-01: las cifras del reporte coinciden con su servicio de origen (catalog-service)', async () => {
    const zonas = reporte.secciones.find((s: any) => s.clave === 'zonas_analizadas');
    const origen = await http('GET', '/v1/zones?limit=1', analista, undefined, undefined, CATALOG);
    if (origen.estado !== 200) return; // catalog apagado: el reporte lo marca no disponible
    expect(zonas).toMatchObject({ disponible: true, valor: origen.cuerpo.total });
  });

  it('GET /reports/:id devuelve lo guardado; id mal formado 400; inexistente 404', async () => {
    const r = await http('GET', `/v1/reports/${reporteId}`, auditor);
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toEqual(reporte);
    expect((await http('GET', '/v1/reports/abc', gerente)).estado).toBe(400);
    expect((await http('GET', '/v1/reports/6705f1c2a3b4c5d6e7f80000', gerente)).estado).toBe(404);
  });

  it('GET /reports: paginado, más reciente primero, con filtros por usuario, tipo y fechas', async () => {
    await http('POST', '/v1/reports/executive', gerente, PERIODO);
    const lista = await http('GET', `/v1/reports?usuarioId=${PREFIJO}ger&limit=1`, admin);
    expect(lista.estado).toBe(200);
    expect(lista.cuerpo).toMatchObject({ page: 1, limit: 1 });
    expect(lista.cuerpo.total).toBeGreaterThanOrEqual(2);
    expect(lista.cuerpo.data).toHaveLength(1);

    const todos = (await http('GET', `/v1/reports?usuarioId=${PREFIJO}ger&limit=100`, admin)).cuerpo.data;
    const fechas = todos.map((x: any) => Date.parse(x.creadoEn));
    expect(fechas).toEqual([...fechas].sort((a, b) => b - a));

    expect((await http('GET', '/v1/reports?tipo=otro', admin)).cuerpo.data.filter((x: any) => x.usuarioId.startsWith(PREFIJO))).toEqual([]);
    const hoy = new Date().toISOString().slice(0, 10);
    expect((await http('GET', `/v1/reports?usuarioId=${PREFIJO}ger&dateFrom=${hoy}&dateTo=${hoy}`, admin)).cuerpo.total).toBeGreaterThanOrEqual(2);
    expect((await http('GET', `/v1/reports?usuarioId=${PREFIJO}ger&dateTo=2020-01-01`, admin)).cuerpo.total).toBe(0);
    expect((await http('GET', '/v1/reports?page=9999', admin)).cuerpo.data).toEqual([]);
    expect((await http('GET', '/v1/reports?page=0', admin)).estado).toBe(400);
  });

  it('DOC-04: el Proveedor no ve reportes ajenos (lista vacía, 404 en el detalle y en la exportación)', async () => {
    const lista = await http('GET', `/v1/reports?usuarioId=${PREFIJO}ger`, provA);
    expect(lista.estado).toBe(200);
    expect(lista.cuerpo.data).toEqual([]);
    expect((await http('GET', `/v1/reports/${reporteId}`, provA)).estado).toBe(404);
    expect((await http('GET', `/v1/reports/${reporteId}`, provB)).estado).toBe(404);
    expect((await http('GET', `/v1/reports/${reporteId}/export?format=pdf`, provA)).estado).toBe(404);
    expect((await http('PATCH', `/v1/reports/${reporteId}`, provA, { estado: 'exportado' })).estado).toBe(403);
  });

  it('PATCH: solo el Gerente cambia el estado; estado inválido 400', async () => {
    expect((await http('PATCH', `/v1/reports/${reporteId}`, admin, { estado: 'exportado' })).estado).toBe(403);
    expect((await http('PATCH', `/v1/reports/${reporteId}`, gerente, { estado: 'otro' })).estado).toBe(400);
    const r = await http('PATCH', `/v1/reports/${reporteId}`, gerente, { estado: 'exportado' });
    expect(r.estado).toBe(200);
    expect(r.cuerpo.estado).toBe('exportado');
    await http('PATCH', `/v1/reports/${reporteId}`, gerente, { estado: 'generado' });
  });

  it('DOC-02: exporta a PDF con los mismos números que el JSON y los acentos bien', async () => {
    const r = await fetch(`${BASE}/v1/reports/${reporteId}/export?format=pdf`, { headers: { Authorization: `Bearer ${auditor}` } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/pdf');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="reporte-ejecutivo-\d{4}-\d{2}-\d{2}\.pdf"$/);

    const buffer = Buffer.from(await r.arrayBuffer());
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const texto: string = (await pdfParse(buffer)).text;
    expect(texto).toContain('Reporte ejecutivo');
    expect(texto).toContain('Periodo: 2026-08-01 a 2026-08-31');
    expect(texto).toContain('Frecuencia de compra (canastas por mes)'); // acentos y paréntesis
    expect(texto).toContain('Productos de la canasta básica disponibles'); // á
    expect(texto).toContain('Categorías principales por gasto'); // í
    // Cada indicador disponible con valor numérico aparece con el mismo número que el JSON.
    for (const s of reporte.secciones.filter((x: any) => x.disponible && typeof x.valor === 'number')) {
      const esperado = Number.isInteger(s.valor) ? String(s.valor) : s.valor.toFixed(2);
      expect(texto).toContain(esperado);
    }
    for (const s of reporte.secciones.filter((x: any) => !x.disponible)) expect(texto).toContain(s.motivo.slice(0, 20));

    // El export marca el reporte como exportado.
    expect((await http('GET', `/v1/reports/${reporteId}`, gerente)).cuerpo.estado).toBe('exportado');
    expect((await http('GET', `/v1/reports/${reporteId}/export?format=docx`, gerente)).estado).toBe(400);
    expect((await http('GET', `/v1/reports/${reporteId}/export`, gerente)).estado).toBe(400);
  });

  it('D-19: exporta a Excel con las cifras como celdas NUMÉRICAS, iguales al JSON; los no disponibles sin valor', async () => {
    const r = await fetch(`${BASE}/v1/reports/${reporteId}/export?format=xlsx`, { headers: { Authorization: `Bearer ${auditor}` } });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="reporte-ejecutivo-\d{4}-\d{2}-\d{2}\.xlsx"$/);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(Buffer.from(await r.arrayBuffer()) as unknown as ExcelJS.Buffer);
    const hoja = libro.getWorksheet('Indicadores')!;
    const filas: Array<{ indicador: string; valor: unknown; estado: string }> = [];
    hoja.eachRow((fila, n) => {
      if (n > 1) filas.push({ indicador: String(fila.getCell(2).value), valor: fila.getCell(3).value, estado: String(fila.getCell(4).value) });
    });

    for (const s of reporte.secciones.filter((x: any) => x.disponible && typeof x.valor === 'number')) {
      const fila = filas.find((f) => f.indicador === s.nombre)!;
      expect(typeof fila.valor).toBe('number'); // celda numérica, no texto
      expect(fila.valor).toBe(s.valor);
    }
    for (const s of reporte.secciones.filter((x: any) => !x.disponible)) {
      const fila = filas.find((f) => f.indicador === s.nombre)!;
      expect(fila.estado).toBe('No disponible');
      expect(fila.valor).toBeNull(); // nunca 0
    }
    // Un Proveedor no exporta el de otro.
    expect((await http('GET', `/v1/reports/${reporteId}/export?format=xlsx`, provA)).estado).toBe(404);
  });

  it('DOC-03: la agregación por usuario y mes cuenta lo guardado', async () => {
    const r = await http('GET', '/v1/reports/stats/by-user-month', admin);
    expect(r.estado).toBe(200);
    const mio = r.cuerpo.data.find((x: any) => x.usuarioId === `${PREFIJO}ger`);
    expect(mio.reportes).toBeGreaterThanOrEqual(2);
    expect(mio.mes).toMatch(/^\d{4}-\d{2}$/);
    expect((await http('GET', '/v1/reports/stats/by-user-month', provA)).cuerpo.data).toEqual([]);
  });

  it('DOC-03: la colección tiene sus dos índices y las consultas del historial los usan (IXSCAN)', async () => {
    const col = mongoose.connection.collection('reportes');
    const llaves = (await col.indexes()).map((i) => JSON.stringify(i.key));
    expect(llaves).toContain(JSON.stringify({ usuarioId: 1, creadoEn: -1 }));
    expect(llaves).toContain(JSON.stringify({ tipo: 1, creadoEn: -1 }));

    const porUsuario = await col.find({ usuarioId: `${PREFIJO}ger` }).sort({ creadoEn: -1 }).explain('queryPlanner');
    expect(JSON.stringify(porUsuario)).toContain('IXSCAN');
    const porTipo = await col.find({ tipo: 'ejecutivo' }).sort({ creadoEn: -1 }).explain('queryPlanner');
    expect(JSON.stringify(porTipo)).toContain('IXSCAN');
  });

  it('XML: reportResponse y reportListResponse con el namespace documents/v1', async () => {
    const uno = await http('GET', `/v1/reports/${reporteId}`, gerente, undefined, 'application/xml');
    expect(uno.estado).toBe(200);
    expect(uno.cabeceras.get('content-type')).toContain('application/xml');
    expect(uno.texto).toContain('<reportResponse xmlns="documents/v1">');
    expect(uno.texto).toContain('<secciones>');

    const lista = await http('GET', '/v1/reports?limit=2', gerente, undefined, 'application/xml');
    expect(lista.texto).toContain('<reportListResponse xmlns="documents/v1">');
    expect(lista.texto).toContain('<total>');

    const stats = await http('GET', '/v1/reports/stats/by-user-month', gerente, undefined, 'application/xml');
    expect(stats.texto).toContain('<reportStatsResponse xmlns="documents/v1">');
  });

  it('el error en XML mantiene el cuerpo estándar', async () => {
    const r = await http('GET', '/v1/reports/abc', gerente, undefined, 'application/xml');
    expect(r.estado).toBe(400);
    expect(r.texto).toContain('<error');
    expect(r.texto).toContain('<statusCode>400</statusCode>');
  });
});
