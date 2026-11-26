/**
 * Integración de offline-sync-service contra MongoDB y Redis REALES y
 * aislados (contenedores `offline-sync-it-*`). El destino es el
 * `DestinoSimulado` (`SYNC_DESTINO=simulado`, por sus ganchos de prueba; los
 * destinos reales los prueba `destinos-reales.integracion.spec.ts`); audit-service y
 * notifications-service son un servidor falso.
 *
 *   npm run test:integracion
 */
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import { ROL } from '../src/common/roles';
import { DESTINO_CAPTURAS } from '../src/sync/destinos/destino';
import { DestinoSimulado } from '../src/sync/destinos/destino-simulado';
import { SyncService } from '../src/sync/sync.service';
import { MONGO, REDIS } from './contenedores';
import {
  errorDeXsd,
  esperarHasta,
  HEALTH_XSD,
  http,
  levantarApp,
  pausar,
  reanudar,
  servidorFalso,
  Sesion,
  sesion,
  usaDocker,
} from './apoyo';

const TIENDA = '27f05c81-c6bf-456a-a273-150e4edb9900';
const LECHE = '5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77';
const ARROZ = '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e';
const XML = 'application/xml';

function disponibilidad(parcial: Record<string, unknown> = {}) {
  return {
    captureId: randomUUID(),
    type: 'disponibilidad',
    contractVersion: '1.0',
    capturedAt: '2026-10-26T09:30:00-06:00',
    storeId: TIENDA,
    presentationId: LECHE,
    content: { stock: 12 },
    ...parcial,
  };
}

function precio(parcial: Record<string, unknown> = {}) {
  return disponibilidad({ type: 'precio_observado', content: { price: 27.5, lat: 25.6866, lng: -100.3161 }, ...parcial });
}

function lote(captures: unknown[], parcial: Record<string, unknown> = {}) {
  return {
    batchId: randomUUID(),
    deviceId: randomUUID(),
    contractVersion: '1.0',
    client: 'movil',
    sentAt: '2026-10-30T09:02:00-06:00',
    captures,
    ...parcial,
  };
}

/** El mismo lote en XML (contrato §4.2). */
function loteXml(l: ReturnType<typeof lote>): string {
  const capturas = (l.captures as Array<ReturnType<typeof disponibilidad>>)
    .map((c) => {
      const contenido = Object.entries(c.content as Record<string, number>)
        .map(([k, v]) => `<${k}>${v}</${k}>`)
        .join('');
      return `<item><captureId>${c.captureId}</captureId><type>${c.type}</type><contractVersion>${c.contractVersion}</contractVersion><capturedAt>${c.capturedAt}</capturedAt><storeId>${c.storeId}</storeId><presentationId>${c.presentationId}</presentationId><content>${contenido}</content></item>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><loteSync xmlns="sync/v1"><batchId>${l.batchId}</batchId><deviceId>${l.deviceId}</deviceId><contractVersion>${l.contractVersion}</contractVersion><client>${l.client}</client><captures>${capturas}</captures></loteSync>`;
}

describe('offline-sync-service · integración (Mongo y Redis reales, aislados)', () => {
  let app: INestApplication;
  let base: string;
  let lotes: string;
  let redis: Redis;
  let mongo: MongoClient;
  let destino: DestinoSimulado;
  let sync: SyncService;
  let falso: Awaited<ReturnType<typeof servidorFalso>>;
  let investigador: Sesion;
  let analista: Sesion;

  beforeAll(async () => {
    // audit acepta (201); notifications rechaza (400), como hoy con un servicio fuera de su lista.
    falso = await servidorFalso({ '/v1/auditoria': 201, '/v1/notifications': 400 });
    process.env.AUDIT_SERVICE_URL = falso.url;
    process.env.NOTIFICATIONS_SERVICE_URL = falso.url;

    ({ app, base } = await levantarApp());
    lotes = `${base}/v1/sync/batches`;
    destino = app.get(DESTINO_CAPTURAS);
    sync = app.get(SyncService);
    redis = new Redis({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT) });
    mongo = new MongoClient(process.env.MONGO_URL as string);
    await mongo.connect();
    await mongo.db('offline_sync_it').dropDatabase();
    investigador = await sesion(redis, ROL.INVESTIGADOR);
    analista = await sesion(redis, ROL.ANALISTA);
  });

  afterAll(async () => {
    await sync?.esperarAvisos();
    await app?.close();
    await mongo?.close();
    redis?.disconnect();
    await falso?.cerrar();
  });

  beforeEach(() => destino.reiniciar());

  const db = () => mongo.db('offline_sync_it');

  // ------------------------------------------------------------ health
  it('GET /v1/health: 200 con Mongo y Redis ok, en JSON y en XML (health.xsd), con X-Correlation-Id', async () => {
    const r = await http('GET', `${base}/v1/health`, { correlacion: 'it-health-1' });
    expect(r.estado).toBe(200);
    expect(r.correlacion).toBe('it-health-1');
    expect(r.cuerpo.checks).toEqual({ postgres: 'no configurado', mongodb: 'ok', redis: 'ok' });
    expect(r.cuerpo.status).toBe('ok');
    // Modo del destino: solo en JSON (health.xsd no lo admite).
    expect(r.cuerpo.destinos).toEqual({ modo: 'simulado', availability: 'no configurado', pricing: 'no configurado' });
    const x = await http('GET', `${base}/v1/health`, { accept: XML });
    expect(x.texto).not.toContain('xmlns');
    expect(errorDeXsd(x.texto, HEALTH_XSD)).toBeNull();
  });

  // ------------------------------------------------------------ 401 / 403 / 404
  describe('autenticación y permisos', () => {
    it('401 sin token y 401 con token válido pero sin sesión en Redis', async () => {
      const sinToken = await http('POST', lotes, { json: lote([precio()]) });
      expect(sinToken.estado).toBe(401);
      expect(sinToken.cuerpo.code).toBe('UNAUTHORIZED');
      expect(sinToken.correlacion).toBeTruthy();

      const sinSesion = await sesion(redis, ROL.INVESTIGADOR, false);
      const r = await http('POST', lotes, { token: sinSesion.token, json: lote([precio()]) });
      expect(r.estado).toBe(401);
      expect(r.cuerpo.message).toContain('Sesión inactiva');
    });

    it.each([ROL.PLANEADOR, ROL.GERENTE_CATEGORIA, ROL.ADMINISTRADOR, ROL.AUDITOR, ROL.PROVEEDOR])(
      '403 al enviar un lote como %s',
      async (rol) => {
        const s = await sesion(redis, rol);
        const r = await http('POST', lotes, { token: s.token, json: lote([precio()]), accept: XML });
        expect(r.estado).toBe(403);
        expect(r.texto).toContain('<code>FORBIDDEN</code>');
        expect(errorDeXsd(r.texto)).toBeNull();
        expect(destino.llamadas).toHaveLength(0);
      },
    );

    it('403 por tipo: el Responsable de precios no da de alta disponibilidad (solo esa captura)', async () => {
      const rp = await sesion(redis, ROL.RESPONSABLE_PRECIOS);
      const r = await http('POST', lotes, { token: rp.token, json: lote([disponibilidad(), precio()]) });
      expect(r.estado).toBe(200);
      expect(r.cuerpo.results.map((x: { status: string; reason: { code: string } | null }) => [x.status, x.reason?.code ?? null])).toEqual([
        ['rechazada', 'FORBIDDEN'],
        ['aceptada', null],
      ]);
    });

    it('GET de un lote ajeno → 404 (mismo cuerpo que inexistente); el Auditor sí lo ve; userId solo Admin/Auditor', async () => {
      const envio = lote([precio()]);
      expect((await http('POST', lotes, { token: investigador.token, json: envio })).estado).toBe(200);
      const otro = await sesion(redis, ROL.INVESTIGADOR);
      const ajeno = await http('GET', `${lotes}/${envio.batchId}`, { token: otro.token });
      const inexistente = await http('GET', `${lotes}/${randomUUID()}`, { token: otro.token });
      expect(ajeno.estado).toBe(404);
      expect(ajeno.cuerpo.message).toBe(inexistente.cuerpo.message);
      const aud = await sesion(redis, ROL.AUDITOR);
      expect((await http('GET', `${lotes}/${envio.batchId}`, { token: aud.token })).estado).toBe(200);
      expect((await http('GET', `${lotes}?userId=${investigador.id}`, { token: otro.token })).estado).toBe(403);
      expect((await http('GET', `${lotes}/no-es-uuid`, { token: otro.token })).estado).toBe(400);
    });
  });

  // ------------------------------------------------------------ lote mixto
  it('lote mixto: aceptada + duplicada + conflicto + rechazada; Mongo y Redis guardan; correlación y avisos', async () => {
    const yaEnviada = precio({ presentationId: ARROZ });
    expect((await http('POST', lotes, { token: investigador.token, json: lote([yaEnviada]) })).estado).toBe(200);
    destino.sembrarDato({ type: 'disponibilidad', storeId: TIENDA, presentationId: ARROZ }, '2026-10-28T16:00:00.000Z');

    const aceptada = disponibilidad({ storeId: randomUUID() });
    const conflicto = disponibilidad({ presentationId: ARROZ, capturedAt: '2026-10-27T10:00:00-06:00', content: { stock: 0 } });
    const rechazada = precio({ storeId: randomUUID(), content: { price: -3 } });
    const envio = lote([aceptada, yaEnviada, conflicto, rechazada]);
    const r = await http('POST', lotes, { token: investigador.token, json: envio, correlacion: 'it-mixto-1' });

    expect(r.estado).toBe(200);
    expect(r.correlacion).toBe('it-mixto-1');
    expect(r.cuerpo.correlationId).toBe('it-mixto-1');
    expect(r.cuerpo.userId).toBe(investigador.id);
    expect(r.cuerpo.summary).toEqual({ total: 4, aceptadas: 1, duplicadas: 1, conflictos: 1, rechazadas: 1 });
    const [a, d, c, x] = r.cuerpo.results;
    expect([a.status, d.status, c.status, x.status]).toEqual(['aceptada', 'duplicada', 'conflicto', 'rechazada']);
    expect(a.target).toEqual({ service: 'availability-service', id: aceptada.captureId });
    expect(d.originalStatus).toBe('aceptada');
    expect(d.target.service).toBe('pricing-service');
    expect(c.serverCapturedAt).toBe('2026-10-28T16:00:00.000Z');
    expect(x.reason).toEqual({ code: 'VALIDATION_ERROR', message: 'content.price debe ser mayor a 0.' });

    // Mongo: el lote y cada captura; el conflicto se guarda con su contenido (no se pierde).
    const doc = await db().collection('lotes_sync').findOne({ _id: envio.batchId as never });
    expect(doc?.estado).toBe('terminado');
    expect(doc?.correlationId).toBe('it-mixto-1');
    const cConflicto = await db().collection('capturas_sync').findOne({ _id: conflicto.captureId as never });
    expect(cConflicto).toEqual(expect.objectContaining({ status: 'conflicto', content: { stock: 0 } }));
    // Redis: idempotencia por captureId y último estado.
    expect(JSON.parse((await redis.get(`sync:captura:${aceptada.captureId}`)) as string).status).toBe('aceptada');
    expect(await redis.get(`sync:ultimo:disponibilidad:${aceptada.storeId}:${LECHE}`)).toBe('2026-10-26T15:30:00.000Z');
    // Correlación hacia el destino.
    expect(destino.llamadas.find((l) => l.captureId === aceptada.captureId)?.correlationId).toBe('it-mixto-1');

    // Auditoría y aviso: no bloqueantes, con la misma correlación; el aviso falla (400) y queda marcado.
    await sync.esperarAvisos();
    const auditoria = falso.recibidas.find((p) => p.ruta === '/v1/auditoria' && p.cuerpo.registroId === envio.batchId);
    expect(auditoria?.headers['x-correlation-id']).toBe('it-mixto-1');
    expect(auditoria?.headers.authorization).toBe(`Bearer ${investigador.token}`);
    expect(auditoria?.cuerpo).toEqual(expect.objectContaining({ tabla: 'lotes_sync', servicio: 'offline-sync-service', accion: 'insert' }));
    const aviso = falso.recibidas.find((p) => p.ruta === '/v1/notifications' && p.cuerpo.relatedEntityId === envio.batchId);
    expect(aviso?.cuerpo).toEqual(expect.objectContaining({ eventType: 'sync.conflicto', recipientUserId: investigador.id }));
    const entregado = await db().collection('lotes_sync').findOne({ _id: envio.batchId as never });
    expect(entregado?.delivery).toEqual(
      expect.objectContaining({ audit: 'enviado', notification: 'fallido', notificationError: expect.stringContaining('HTTP 400') }),
    );

    // Reenvío: todas duplicada, sin volver a llamar al destino.
    const llamadas = destino.llamadas.length;
    const otraVez = await http('POST', lotes, { token: investigador.token, json: envio });
    expect(otraVez.cuerpo.resend).toBe(true);
    expect(otraVez.cuerpo.results.map((y: { status: string }) => y.status)).toEqual(['duplicada', 'duplicada', 'duplicada', 'duplicada']);
    expect(otraVez.cuerpo.results.map((y: { originalStatus: string }) => y.originalStatus)).toEqual([
      'aceptada',
      'aceptada',
      'conflicto',
      'rechazada',
    ]);
    expect(destino.llamadas.length).toBe(llamadas);

    // GET devuelve el acuse guardado tal como se emitió la primera vez: la captura
    // que venía de OTRO lote sigue como duplicada; las de este lote, con su estado.
    const guardado = await http('GET', `${lotes}/${envio.batchId}`, { token: investigador.token });
    expect(guardado.cuerpo.resend).toBe(false);
    expect(guardado.cuerpo.results.map((y: { status: string }) => y.status)).toEqual(['aceptada', 'duplicada', 'conflicto', 'rechazada']);
    expect(guardado.cuerpo.results[1].originalStatus).toBe('aceptada');
  });

  // ------------------------------------------------------------ XML
  describe('XML de entrada y salida (escritorio)', () => {
    it('lote en XML con Accept XML: el acuse valida contra el XSD', async () => {
      const envio = lote([disponibilidad({ storeId: randomUUID() }), precio({ storeId: randomUUID(), content: { price: 0 } })], {
        client: 'escritorio',
      });
      const entrada = loteXml(envio);
      expect(errorDeXsd(entrada)).toBeNull();
      const r = await http('POST', lotes, { token: analista.token, xml: entrada, accept: XML });
      expect(r.estado).toBe(200);
      expect(r.tipo).toContain('application/xml');
      expect(errorDeXsd(r.texto)).toBeNull();
      expect(r.texto).toContain('<status>aceptada</status>');
      expect(r.texto).toContain('<status>rechazada</status>');
      expect(r.texto).toContain('<client>escritorio</client>');

      // El mismo lote mandado después en JSON es un reenvío (misma huella).
      const json = await http('POST', lotes, { token: analista.token, json: envio });
      expect(json.cuerpo.resend).toBe(true);

      const lista = await http('GET', `${lotes}?status=rechazada`, { token: analista.token, accept: XML });
      expect(lista.estado).toBe(200);
      expect(errorDeXsd(lista.texto)).toBeNull();
      const uno = await http('GET', `${lotes}/${envio.batchId}`, { token: analista.token, accept: XML });
      expect(errorDeXsd(uno.texto)).toBeNull();
    });

    it('XML sin zona horaria → 400 del lote completo, error en XML válido contra el XSD', async () => {
      const envio = lote([precio({ capturedAt: '2026-10-26T09:30:00' })]);
      const r = await http('POST', lotes, { token: analista.token, xml: loteXml(envio), accept: XML });
      expect(r.estado).toBe(400);
      expect(r.texto).toContain('<code>VALIDATION_ERROR</code>');
      expect(r.texto).toContain('capturedAt');
      expect(errorDeXsd(r.texto)).toBeNull();
      expect(destino.llamadas).toHaveLength(0);
    });

    it('XML con DOCTYPE, mal formado, raíz distinta o Content-Type desconocido → 400', async () => {
      const malo = [
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><loteSync xmlns="sync/v1"/>',
        '<loteSync xmlns="sync/v1"><batchId>',
        '<otraRaiz xmlns="sync/v1"/>',
      ];
      for (const xml of malo) {
        expect((await http('POST', lotes, { token: analista.token, xml })).estado).toBe(400);
      }
      const texto = await http('POST', lotes, { token: analista.token, cuerpo: 'hola', contentType: 'text/plain' });
      expect(texto.estado).toBe(400);
      expect(texto.cuerpo.message).toContain('Content-Type');
    });

    it('JSON sin zona horaria o con un campo no permitido (userId) → 400 del lote', async () => {
      const sinZona = await http('POST', lotes, { token: investigador.token, json: lote([precio({ capturedAt: '2026-10-26T09:30:00' })]) });
      expect(sinZona.estado).toBe(400);
      expect(sinZona.cuerpo.details.join()).toContain('capturedAt');
      const conUsuario = await http('POST', lotes, { token: investigador.token, json: { ...lote([precio()]), userId: randomUUID() } });
      expect(conUsuario.estado).toBe(400);
    });
  });

  // ------------------------------------------------------------ 413
  it('413 con más de 500 capturas y con cuerpo de más de 1 MB (code VALIDATION_ERROR)', async () => {
    const muchas = lote(Array.from({ length: 501 }, () => precio({ storeId: randomUUID() })));
    const r = await http('POST', lotes, { token: investigador.token, json: muchas });
    expect(r.estado).toBe(413);
    expect(r.cuerpo.code).toBe('VALIDATION_ERROR');
    expect(r.cuerpo.message).toContain('trae 501');

    const enorme = await http('POST', lotes, {
      token: investigador.token,
      cuerpo: JSON.stringify({ ...lote([precio()]), relleno: 'x'.repeat(1_100_000) }),
      contentType: 'application/json',
      accept: XML,
    });
    expect(enorme.estado).toBe(413);
    expect(errorDeXsd(enorme.texto)).toBeNull();
    expect(destino.llamadas).toHaveLength(0);
  });

  // ------------------------------------------------------------ concurrencia
  it('repetición simultánea del mismo lote: un solo procesamiento; nada se envía dos veces', async () => {
    destino.latencia(300);
    const envio = lote([disponibilidad({ storeId: randomUUID() }), precio({ storeId: randomUUID() }), precio({ storeId: randomUUID() })]);
    const [uno, dos] = await Promise.all([
      http('POST', lotes, { token: investigador.token, json: envio }),
      http('POST', lotes, { token: investigador.token, json: envio }),
    ]);
    const estados = [uno.estado, dos.estado].sort();
    expect(estados).toEqual([200, 409]);
    const conflicto = uno.estado === 409 ? uno : dos;
    expect(conflicto.cuerpo.message).toContain('se está procesando');
    expect(destino.llamadas).toHaveLength(3);
    expect(await db().collection('lotes_sync').countDocuments({ _id: envio.batchId as never })).toBe(1);

    const reenvio = await http('POST', lotes, { token: investigador.token, json: envio });
    expect(reenvio.cuerpo.resend).toBe(true);
    expect(destino.llamadas).toHaveLength(3);
  });

  // ------------------------------------------------------------ desconexión
  it('desconexión del cliente después de escribir: el siguiente envío recupera el resultado sin repetirlo', async () => {
    destino.latencia(400);
    const envio = lote([disponibilidad({ storeId: randomUUID() }), precio({ storeId: randomUUID() })]);
    const corte = new AbortController();
    const enVuelo = http('POST', lotes, { token: investigador.token, json: envio, signal: corte.signal });
    setTimeout(() => corte.abort(), 150);
    await expect(enVuelo).rejects.toThrow();

    // El servidor termina aunque el cliente se haya ido.
    await esperarHasta(async () => (await http('GET', `${lotes}/${envio.batchId}`, { token: investigador.token })).estado === 200);
    destino.latencia(0);
    const llamadas = destino.llamadas.length;
    expect(llamadas).toBe(2);

    const reanudado = await http('POST', lotes, { token: investigador.token, json: envio });
    expect(reanudado.estado).toBe(200);
    expect(reanudado.cuerpo.resend).toBe(true);
    expect(reanudado.cuerpo.results.map((r: { status: string; originalStatus: string }) => [r.status, r.originalStatus])).toEqual([
      ['duplicada', 'aceptada'],
      ['duplicada', 'aceptada'],
    ]);
    expect(destino.llamadas.length).toBe(llamadas);
  });

  it('destino sin responder: captura reintentable, guardada; el siguiente envío la procesa', async () => {
    destino.caer(true);
    const envio = lote([precio({ storeId: randomUUID() })]);
    const primero = await http('POST', lotes, { token: investigador.token, json: envio });
    expect(primero.cuerpo.results[0]).toEqual(
      expect.objectContaining({ status: 'rechazada', retryable: true, reason: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }) }),
    );
    const id = (envio.captures[0] as { captureId: string }).captureId;
    expect(await db().collection('capturas_sync').findOne({ _id: id as never })).toEqual(
      expect.objectContaining({ status: 'rechazada', retryable: true }),
    );
    expect(await redis.get(`sync:captura:${id}`)).toBeNull(); // no es final: no entra a la idempotencia
    destino.caer(false);
    const segundo = await http('POST', lotes, { token: investigador.token, json: envio });
    expect(segundo.cuerpo.results[0].status).toBe('aceptada');
    expect(segundo.cuerpo.resend).toBe(true);
  });

  // ------------------------------------------------------------ 503
  (usaDocker ? describe : describe.skip)('503 cuando cae MongoDB o Redis (contenedores en pausa)', () => {
    it('MongoDB caído: POST → 503 sin enviar nada; health degraded; al volver, el mismo lote se procesa', async () => {
      const envio = lote([precio({ storeId: randomUUID() })]);
      pausar(MONGO);
      try {
        const r = await http('POST', lotes, { token: investigador.token, json: envio, accept: XML });
        expect(r.estado).toBe(503);
        expect(r.texto).toContain('<code>SERVICE_UNAVAILABLE</code>');
        expect(errorDeXsd(r.texto)).toBeNull();
        expect(destino.llamadas).toHaveLength(0);
        const salud = await http('GET', `${base}/v1/health`);
        expect(salud.estado).toBe(200);
        expect(salud.cuerpo.status).toBe('degraded');
        expect(salud.cuerpo.checks.mongodb).toMatch(/^error/);
      } finally {
        reanudar(MONGO);
      }
      await esperarHasta(async () => (await http('GET', `${base}/v1/health`)).cuerpo.checks.mongodb === 'ok', 30000);
      const despues = await http('POST', lotes, { token: investigador.token, json: envio });
      expect(despues.estado).toBe(200);
      expect(despues.cuerpo.results[0].status).toBe('aceptada');
    });

    it('Redis caído: POST → 503 (no se puede validar la sesión) y no se procesa nada', async () => {
      const envio = lote([precio({ storeId: randomUUID() })]);
      pausar(REDIS);
      try {
        const r = await http('POST', lotes, { token: investigador.token, json: envio });
        expect(r.estado).toBe(503);
        expect(r.cuerpo.code).toBe('SERVICE_UNAVAILABLE');
        expect(destino.llamadas).toHaveLength(0);
        const salud = await http('GET', `${base}/v1/health`);
        expect(salud.cuerpo.checks.redis).toMatch(/^error/);
      } finally {
        reanudar(REDIS);
      }
      await esperarHasta(async () => (await http('GET', `${base}/v1/health`)).cuerpo.checks.redis === 'ok', 30000);
      expect(await db().collection('lotes_sync').countDocuments({ _id: envio.batchId as never })).toBe(0);
    });
  });

  // ------------------------------------------------------------ Swagger
  it('Swagger documenta petición y respuestas con ejemplo JSON y XML; los XML validan contra el XSD', async () => {
    const r = await http('GET', `${base}/docs-json`);
    expect(r.estado).toBe(200);
    const post = r.cuerpo.paths['/v1/sync/batches'].post;
    expect(post.requestBody.content['application/json'].examples.lote.value.captures).toHaveLength(4);
    const loteEjemplo = post.requestBody.content['application/xml'].example as string;
    expect(errorDeXsd(loteEjemplo)).toBeNull();
    const ok = post.responses['200'].content;
    expect(ok['application/json'].examples.primerEnvio.value.results).toHaveLength(4);
    for (const nombre of ['primerEnvio', 'reenvio']) expect(errorDeXsd(ok['application/xml'].examples[nombre].value)).toBeNull();
    for (const estado of ['400', '401', '403', '409', '413', '503']) {
      expect(post.responses[estado].content['application/json'].example.statusCode).toBe(Number(estado));
      expect(errorDeXsd(post.responses[estado].content['application/xml'].example)).toBeNull();
    }
    const lista = r.cuerpo.paths['/v1/sync/batches'].get.responses['200'].content['application/xml'].example;
    expect(errorDeXsd(lista)).toBeNull();
    const salud = r.cuerpo.paths['/v1/health'].get.responses['200'].content['application/xml'].example;
    expect(errorDeXsd(salud, HEALTH_XSD)).toBeNull();
  });
});
