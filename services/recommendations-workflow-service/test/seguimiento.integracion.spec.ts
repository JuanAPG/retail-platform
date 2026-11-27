/**
 * Integración de recommendations-workflow-service contra el stack LOCAL real:
 * PostgreSQL (tablas de db/migraciones/sprint4_recommendations_workflow.sql),
 * Redis, auth-service (sesiones reales) y decision-service (recomendaciones
 * reales). La app corre en este proceso con el MISMO `configurarApp` que
 * main.ts. Cada XML se valida contra el XSD OFICIAL con libxml2.
 *
 * Las recomendaciones se preparan SOLO con rutas reales de decision-service:
 * se listan las `propuesta` (si no hay 3, el Planeador genera) y el Gerente
 * aprueba una (aceptada) y rechaza otra (descartada). Nunca se escribe en
 * `recomendaciones` directo.
 *
 * Requisitos (si falta alguno, la prueba FALLA diciendo qué):
 *   docker compose -f infra/docker-compose.yml up -d postgres redis auth-service decision-service
 *   db/migraciones/sprint4_recommendations_workflow.sql aplicada
 *   npm run test:integracion
 *
 * Al terminar borra sus seguimientos (tablas de este servicio). Lo hecho en
 * decision-service (aprobar, rechazar, generar) se queda: es historial de
 * decisiones y no se borra.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { AddressInfo } from 'net';
import { resolve } from 'path';
import { validateXML } from 'xmllint-wasm';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/app.setup';
import { diaLocal } from '../src/common/fechas';

const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';
const DECISION = process.env.DECISION_SERVICE_URL as string;
const POSTGRES = process.env.POSTGRES_CONTAINER ?? 'retail_postgres';
const CLAVE = process.env.WF_IT_PASSWORD ?? 'Passw0rd123!';
const XML = 'application/xml';

const CONTRATOS = resolve(__dirname, '../../../docs/contratos');
const XSD = readFileSync(resolve(CONTRATOS, 'recommendations-workflow-service.xsd'), 'utf8');
const HEALTH_XSD = readFileSync(resolve(CONTRATOS, 'health.xsd'), 'utf8');

async function erroresXsd(xml: string, xsd = XSD): Promise<string[]> {
  const r = await validateXML({ xml: [{ fileName: 'r.xml', contents: xml }], schema: [{ fileName: 's.xsd', contents: xsd }] });
  return r.valid ? [] : r.errors.map((e) => e.rawMessage.trim());
}

function sql(consulta: string): string[] {
  return execFileSync('docker', ['exec', POSTGRES, 'psql', '-U', 'retail_user', '-d', 'retaildb', '-t', '-A', '-F', '|', '-c', consulta], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
}

async function entrar(email: string): Promise<{ token: string; id: string }> {
  const r = await fetch(`${AUTH}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  const cuerpo = (await r.json()) as { accessToken?: string };
  if (!cuerpo.accessToken) throw new Error(`No se pudo iniciar sesión como ${email} en ${AUTH} (HTTP ${r.status}).`);
  const { sub } = JSON.parse(Buffer.from(cuerpo.accessToken.split('.')[1], 'base64url').toString()) as { sub: string };
  return { token: cuerpo.accessToken, id: sub };
}

/** Llamada a decision-service (para preparar recomendaciones con sus rutas reales). */
async function decision(metodo: string, ruta: string, token: string, cuerpo?: unknown) {
  const r = await fetch(`${DECISION}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  return { estado: r.status, json: texto ? JSON.parse(texto) : null };
}

async function requisitos(): Promise<string[]> {
  const faltan: string[] = [];
  for (const [nombre, url] of [['auth-service', AUTH], ['decision-service', DECISION]]) {
    try {
      const r = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) faltan.push(`${nombre} responde ${r.status} en ${url}/v1/health`);
    } catch {
      faltan.push(`${nombre} no responde en ${url} (docker compose -f infra/docker-compose.yml up -d ${nombre})`);
    }
  }
  try {
    const [a, b] = sql("SELECT to_regclass('public.recomendacion_seguimientos') IS NOT NULL; SELECT to_regclass('public.seguimiento_eventos') IS NOT NULL;");
    if (a !== 't' || b !== 't') faltan.push('faltan las tablas recomendacion_seguimientos / seguimiento_eventos: aplica db/migraciones/sprint4_recommendations_workflow.sql');
  } catch (e) {
    faltan.push(`no se pudo revisar la base en el contenedor ${POSTGRES}: ${(e as Error).message.split('\n')[0]}`);
  }
  return faltan;
}

describe('recommendations-workflow-service · integración (Postgres, Redis, auth y decision reales)', () => {
  let app: INestApplication;
  let base: string;
  let gerente: { token: string; id: string };
  let precios: { token: string; id: string };
  let analista: { token: string; id: string };
  let proveedor: { token: string; id: string };
  let aceptada: string;
  let descartada: string;
  let propuesta: string;
  let seguimientoId: string;
  const hoy = diaLocal();
  const ayer = new Date(Date.parse(`${hoy}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const faltan = await requisitos();
    if (faltan.length) throw new Error(`No se puede correr la integración. Falta:\n - ${faltan.join('\n - ')}`);

    const planeador = await entrar('planeador@retail.mx');
    [gerente, precios, analista, proveedor] = await Promise.all([
      entrar('gercategoria@retail.mx'),
      entrar('precios@retail.mx'),
      entrar('analista@retail.mx'),
      entrar('contacto@bioorganicos.mx'),
    ]);

    // Recomendaciones con las rutas REALES de decision-service (D-12: genera el Planeador, decide el Gerente).
    const propuestas = async () =>
      ((await decision('GET', '/v1/recommendations?status=propuesta&limit=100', gerente.token)).json?.data ?? []) as Array<{ id: string }>;
    let lista = await propuestas();
    if (lista.length < 3) {
      const g = await decision('POST', '/v1/recommendations/generate', planeador.token, {});
      if (g.estado !== 201) throw new Error(`decision-service no pudo generar recomendaciones (HTTP ${g.estado}): ${JSON.stringify(g.json)}`);
      lista = await propuestas();
    }
    if (lista.length < 3) {
      throw new Error(`Hacen falta 3 recomendaciones en propuesta y decision-service solo tiene ${lista.length} (POST /v1/recommendations/generate no disparó más reglas con los datos actuales).`);
    }
    [aceptada, descartada, propuesta] = lista.slice(0, 3).map((r) => r.id);
    const ap = await decision('PATCH', `/v1/recommendations/${aceptada}/approve`, gerente.token);
    const re = await decision('PATCH', `/v1/recommendations/${descartada}/reject`, gerente.token, { motivo: 'Prueba de integración del seguimiento (D-41).' });
    if (ap.estado !== 200 || re.estado !== 200) throw new Error(`No se pudo aprobar/rechazar en decision-service (${ap.estado} / ${re.estado}).`);

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: process.env.WF_IT_LOGS === '1' ? undefined : false });
    configurarApp(app);
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app?.close();
    if (aceptada) {
      sql(
        `DELETE FROM seguimiento_eventos WHERE seguimiento_id IN (SELECT id FROM recomendacion_seguimientos WHERE recomendacion_id = '${aceptada}');
         DELETE FROM recomendacion_seguimientos WHERE recomendacion_id = '${aceptada}';`,
      );
    }
  });

  async function http(metodo: string, ruta: string, o: { token?: string; json?: unknown; xml?: string; accept?: string } = {}) {
    const headers: Record<string, string> = {};
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    if (o.accept) headers.Accept = o.accept;
    let body: string | undefined;
    if (o.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(o.json);
    } else if (o.xml !== undefined) {
      headers['Content-Type'] = 'application/xml';
      body = o.xml;
    }
    const r = await fetch(`${base}${ruta}`, { method: metodo, headers, body });
    const texto = await r.text();
    const esJson = (r.headers.get('content-type') ?? '').includes('json');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { estado: r.status, json: (esJson && texto ? JSON.parse(texto) : null) as any, texto };
  }

  const ASIGNAR = () => ({ recommendationId: aceptada, assigneeUserId: precios.id, note: 'Aplicar la recomendación en las tiendas de la zona.' });

  it('asignar una recomendación ACEPTADA → 201 asignada', async () => {
    const r = await http('POST', '/v1/workflow/assignments', { token: gerente.token, json: ASIGNAR() });
    expect(r.estado).toBe(201);
    expect(r.json).toMatchObject({ status: 'asignada', recommendationId: aceptada, assigneeUserId: precios.id, assignedBy: gerente.id });
    seguimientoId = r.json.id;
  });

  it('repetir con el mismo responsable (cuerpo y respuesta XML) → 200 el mismo seguimiento, sin evento nuevo', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><asignacionRequest xmlns="workflow/v1"><recommendationId>${aceptada}</recommendationId><assigneeUserId>${precios.id}</assigneeUserId><note>Aplicar la recomendación en las tiendas de la zona.</note></asignacionRequest>`;
    expect(await erroresXsd(xml)).toEqual([]);
    const r = await http('POST', '/v1/workflow/assignments', { token: gerente.token, xml, accept: XML });
    expect(r.estado).toBe(200);
    expect(r.texto).toContain(`<id>${seguimientoId}</id>`);
    expect(await erroresXsd(r.texto)).toEqual([]);
    expect(sql(`SELECT count(*) FROM seguimiento_eventos WHERE seguimiento_id = '${seguimientoId}'`)).toEqual(['1']);
  });

  it('otro responsable → 409; propuesta o descartada → 409 (XML válido); inexistente → 404', async () => {
    const otro = await http('POST', '/v1/workflow/assignments', { token: gerente.token, json: { ...ASIGNAR(), assigneeUserId: analista.id } });
    expect(otro.estado).toBe(409);
    expect(otro.json.details).toEqual([`seguimiento: ${seguimientoId}`]);

    for (const [id, estado] of [[propuesta, 'propuesta'], [descartada, 'descartada']]) {
      const r = await http('POST', '/v1/workflow/assignments', { token: gerente.token, json: { ...ASIGNAR(), recommendationId: id }, accept: XML });
      expect(r.estado).toBe(409);
      expect(r.texto).toContain(`<item>estado en decision-service: ${estado}</item>`);
      expect(await erroresXsd(r.texto)).toEqual([]);
    }
    const no = await http('POST', '/v1/workflow/assignments', { token: gerente.token, json: { ...ASIGNAR(), recommendationId: '00000000-0000-4000-8000-000000000000' } });
    expect(no.estado).toBe(404);
  });

  it('otro usuario (Analista, rol asignable pero no asignado) intenta iniciar → 403', async () => {
    const r = await http('PATCH', `/v1/workflow/assignments/${seguimientoId}/start`, { token: analista.token });
    expect(r.estado).toBe(403);
    expect(r.json.message).toBe('Solo el responsable asignado puede mover este seguimiento.');
  });

  it('evaluar antes de implementar → 409 con el estado actual en details', async () => {
    const r = await http('PATCH', `/v1/workflow/assignments/${seguimientoId}/evaluate`, { token: gerente.token, json: evaluacion() });
    expect(r.estado).toBe(409);
    expect(r.json.details[0]).toBe('estado actual: asignada');
  });

  it('el asignado inicia (200) e implementa con cuerpo XML (200); respuestas XML válidas', async () => {
    const inicio = await http('PATCH', `/v1/workflow/assignments/${seguimientoId}/start`, { token: precios.token, accept: XML });
    expect(inicio.estado).toBe(200);
    expect(inicio.texto).toContain('<status>en_implementacion</status>');
    expect(await erroresXsd(inicio.texto)).toEqual([]);

    const xml = `<?xml version="1.0" encoding="UTF-8"?><implementacionRequest xmlns="workflow/v1"><implementedOn>${hoy}</implementedOn><note>Se aplicó el cambio recomendado en tienda.</note></implementacionRequest>`;
    const impl = await http('PATCH', `/v1/workflow/assignments/${seguimientoId}/implement`, { token: precios.token, xml, accept: XML });
    expect(impl.estado).toBe(200);
    expect(impl.texto).toContain('<status>implementada</status>');
    expect(await erroresXsd(impl.texto)).toEqual([]);
  });

  function evaluacion() {
    // Implementada hoy: antes = ayer, después = hoy (misma duración, after.to ≤ hoy).
    return {
      metric: 'ventas_unidades',
      unit: 'pza',
      scope: { zoneId: 'f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44' },
      before: { from: ayer, to: ayer, value: 1000 },
      after: { from: hoy, to: hoy, value: 1150 },
      source: 'core-process-service, ventas de la zona (prueba de integración)',
    };
  }

  it('evaluar con el Gerente: unidad incompatible → 400; correcta → 200 con variationPct 15 (XML válido)', async () => {
    const mal = await http('PATCH', `/v1/workflow/assignments/${seguimientoId}/evaluate`, { token: gerente.token, json: { ...evaluacion(), unit: 'MXN' } });
    expect(mal.estado).toBe(400);
    expect(mal.json.message).toBe('Unidades incompatibles.');
    const conVariacion = await http('PATCH', `/v1/workflow/assignments/${seguimientoId}/evaluate`, { token: gerente.token, json: { ...evaluacion(), variationPct: 99 } });
    expect(conVariacion.estado).toBe(400); // la variación la calcula el servidor

    const r = await http('PATCH', `/v1/workflow/assignments/${seguimientoId}/evaluate`, { token: gerente.token, json: evaluacion(), accept: XML });
    expect(r.estado).toBe(200);
    expect(r.texto).toContain('<status>evaluada</status>');
    expect(r.texto).toContain('<variationPct>15</variationPct>');
    expect(await erroresXsd(r.texto)).toEqual([]);
  });

  it('historial: los 4 eventos en orden, con estado de auditoría y aviso (XML válido)', async () => {
    await new Promise((r) => setTimeout(r, 2000)); // las entregas tienen timeout de 1.5 s
    const r = await http('GET', `/v1/workflow/assignments/${seguimientoId}/history`, { token: analista.token });
    expect(r.estado).toBe(200);
    expect(r.json.data.map((e: { event: string }) => e.event)).toEqual(['asignada', 'iniciada', 'implementada', 'evaluada']);
    for (const e of r.json.data) {
      expect(['enviado', 'fallido', 'no_aplica']).toContain(e.audit);
      expect(['enviado', 'fallido', 'no_aplica']).toContain(e.notification);
      expect(e.correlationId).toBeTruthy();
    }
    const x = await http('GET', `/v1/workflow/assignments/${seguimientoId}/history`, { token: analista.token, accept: XML });
    expect(await erroresXsd(x.texto)).toEqual([]);
  });

  it('lista y detalle en XML válidos; Proveedor → 403; status=aprobada → 400', async () => {
    const lista = await http('GET', `/v1/workflow/assignments?recommendationId=${aceptada}`, { token: analista.token, accept: XML });
    expect(lista.estado).toBe(200);
    expect(await erroresXsd(lista.texto)).toEqual([]);
    const uno = await http('GET', `/v1/workflow/assignments/${seguimientoId}`, { token: gerente.token, accept: XML });
    expect(await erroresXsd(uno.texto)).toEqual([]);
    expect((await http('GET', '/v1/workflow/assignments', { token: proveedor.token })).estado).toBe(403);
    expect((await http('GET', '/v1/workflow/assignments?status=aprobada', { token: analista.token })).estado).toBe(400);
  });

  it('XML con DOCTYPE → 400 (error XML válido); sin sesión → 401', async () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><asignacionRequest xmlns="workflow/v1"><recommendationId>&e;</recommendationId></asignacionRequest>`;
    const r = await http('POST', '/v1/workflow/assignments', { token: gerente.token, xml, accept: XML });
    expect(r.estado).toBe(400);
    expect(r.texto).toContain('DOCTYPE');
    expect(await erroresXsd(r.texto)).toEqual([]);
    expect((await http('POST', '/v1/workflow/assignments', { json: ASIGNAR() })).estado).toBe(401);
  });

  it('GET /v1/health: postgres y redis ok, mongodb no configurado; XML válido contra health.xsd', async () => {
    const r = await http('GET', '/v1/health');
    expect(r.json.checks).toEqual({ postgres: 'ok', mongodb: 'no configurado', redis: 'ok' });
    expect(await erroresXsd((await http('GET', '/v1/health', { accept: XML })).texto, HEALTH_XSD)).toEqual([]);
  });
});
