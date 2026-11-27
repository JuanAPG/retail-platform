/**
 * Integración con los destinos REALES (contrato §6): offline-sync-service en
 * modo `SYNC_DESTINO=http` contra availability-service (3114) y
 * pricing-service (3103) del stack local, con sesiones reales de
 * auth-service (3101). Mongo y Redis de ESTE servicio siguen siendo los
 * aislados de `contenedores.ts`.
 *
 * Entre sync y cada destino hay un proxy de prueba que reenvía todo tal cual:
 * registra los encabezados (para ver que viajan Authorization y
 * X-Correlation-Id) y se puede "apagar" (corta la conexión) para el caso 4.
 *
 * Requisitos (si falta alguno, la prueba FALLA diciendo qué falta):
 *   docker compose -f infra/docker-compose.yml up -d postgres redis auth-service availability-service pricing-service
 *   db/migraciones/sprint4_availability.sql y db/migraciones/sprint4_pricing_observaciones.sql aplicadas
 *   npm run test:integracion
 *
 * Escribe en la base local (capturas de existencia y observaciones de precio
 * pendientes): no correr contra otra base.
 */
import { INestApplication } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { createServer, IncomingHttpHeaders, Server } from 'http';
import Redis from 'ioredis';
import { AddressInfo } from 'net';
import { errorDeXsd, HEALTH_XSD, http, levantarApp } from './apoyo';

const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';
const AVAILABILITY = process.env.AVAILABILITY_BASE_URL ?? 'http://localhost:3114';
const PRICING = process.env.PRICING_BASE_URL ?? 'http://localhost:3103';
const POSTGRES = process.env.POSTGRES_CONTAINER ?? 'retail_postgres';
const CLAVE = process.env.SYNC_IT_PASSWORD ?? 'Passw0rd123!';
/** El Analista comercial puede dar de alta los dos tipos (contrato §2). */
const ANALISTA = 'analista@retail.mx';
const RESPONSABLE_PRECIOS = 'precios@retail.mx';

interface Usuario {
  token: string;
  id: string;
}

/** Proxy de prueba hacia un destino real. */
interface Proxy {
  url: string;
  caido: boolean;
  llamadas: Array<{ metodo: string; ruta: string; headers: IncomingHttpHeaders }>;
  cerrar(): Promise<void>;
}

async function proxyHacia(destino: string): Promise<Proxy> {
  const estado: Omit<Proxy, 'url' | 'cerrar'> = { caido: false, llamadas: [] };
  const servidor: Server = createServer((req, res) => {
    if (estado.caido) {
      req.socket.destroy(); // como un servicio apagado: la conexión se corta sin respuesta
      return;
    }
    const partes: Buffer[] = [];
    req.on('data', (d: Buffer) => partes.push(d));
    req.on('end', async () => {
      estado.llamadas.push({ metodo: req.method ?? '', ruta: req.url ?? '', headers: req.headers });
      try {
        const { host: _host, 'content-length': _largo, ...headers } = req.headers as Record<string, string>;
        const r = await fetch(`${destino}${req.url}`, {
          method: req.method,
          headers,
          body: partes.length ? Buffer.concat(partes) : undefined,
        });
        res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'application/json' });
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch {
        res.writeHead(502).end();
      }
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const { port } = servidor.address() as AddressInfo;
  return Object.assign(estado, {
    url: `http://127.0.0.1:${port}`,
    cerrar: () => new Promise<void>((ok) => servidor.close(() => ok())),
  });
}

function sql(consulta: string): string[] {
  return execFileSync('docker', ['exec', POSTGRES, 'psql', '-U', 'retail_user', '-d', 'retaildb', '-t', '-A', '-c', consulta], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);
}

async function entrar(email: string): Promise<Usuario> {
  const r = await fetch(`${AUTH}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  const cuerpo = (await r.json()) as { accessToken?: string };
  if (!cuerpo.accessToken) throw new Error(`No se pudo iniciar sesión como ${email} en ${AUTH} (HTTP ${r.status}): ¿está el usuario en la base?`);
  const payload = JSON.parse(Buffer.from(cuerpo.accessToken.split('.')[1], 'base64url').toString()) as { sub: string };
  return { token: cuerpo.accessToken, id: payload.sub };
}

async function getJson(url: string, token: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}: ${await r.text()}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await r.json()) as any;
}

/** Revisa todo lo que el stack necesita; si falta algo, dice exactamente qué. */
async function requisitos(): Promise<string[]> {
  const faltan: string[] = [];
  for (const [nombre, url] of [['auth-service', AUTH], ['availability-service', AVAILABILITY], ['pricing-service', PRICING]]) {
    try {
      const r = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) faltan.push(`${nombre} responde ${r.status} en ${url}/v1/health`);
    } catch {
      faltan.push(`${nombre} no responde en ${url} (docker compose -f infra/docker-compose.yml up -d ${nombre})`);
    }
  }
  try {
    const [tabla, columna] = sql(
      "SELECT to_regclass('public.disponibilidad_capturas') IS NOT NULL; " +
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'precios_observados' AND column_name = 'observacion_id');",
    );
    if (tabla !== 't') faltan.push('falta la tabla disponibilidad_capturas: aplica db/migraciones/sprint4_availability.sql');
    if (columna !== 't') faltan.push('falta la columna precios_observados.observacion_id: aplica db/migraciones/sprint4_pricing_observaciones.sql');
  } catch (e) {
    faltan.push(`no se pudo revisar la base en el contenedor ${POSTGRES}: ${(e as Error).message.split('\n')[0]}`);
  }
  return faltan;
}

describe('offline-sync-service · destinos reales (availability y pricing por HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let redisSync: Redis;
  let proxyAv: Proxy;
  let proxyPr: Proxy;
  let analista: Usuario;
  let precios: Usuario;
  /** Pares tienda + presentación (producto y presentación activos), uno por caso. */
  let pares: Array<{ storeId: string; presentationId: string }>;

  beforeAll(async () => {
    const faltan = await requisitos();
    if (faltan.length) {
      throw new Error(`No se puede correr la integración con destinos reales. Falta:\n - ${faltan.join('\n - ')}`);
    }

    [analista, precios] = await Promise.all([entrar(ANALISTA), entrar(RESPONSABLE_PRECIOS)]);
    // El SessionGuard de ESTE servicio lee su Redis aislado: ahí también va la sesión.
    redisSync = new Redis({ host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT), lazyConnect: true });
    await redisSync.connect();
    await redisSync.set(`session:${analista.id}`, '1', 'EX', 900);

    pares = sql(
      `SELECT t.id || '|' || pp.id FROM producto_presentaciones pp
         JOIN productos p ON p.id = pp.producto_id AND p.estatus::text = 'activo'
         CROSS JOIN LATERAL (SELECT id FROM tiendas ORDER BY random() LIMIT 1) t
        WHERE pp.activo ORDER BY random() LIMIT 3`,
    ).map((f) => {
      const [storeId, presentationId] = f.split('|');
      return { storeId, presentationId };
    });
    if (pares.length < 3) throw new Error('La base no tiene 3 presentaciones activas de productos activos: carga el seed.');

    proxyAv = await proxyHacia(AVAILABILITY);
    proxyPr = await proxyHacia(PRICING);
    process.env.SYNC_DESTINO = 'http';
    process.env.AVAILABILITY_SERVICE_URL = proxyAv.url;
    process.env.PRICING_SERVICE_URL = proxyPr.url;
    ({ app, base } = await levantarApp());
  });

  afterAll(async () => {
    await app?.close();
    await redisSync?.quit();
    await proxyAv?.cerrar();
    await proxyPr?.cerrar();
  });

  const hace = (ms: number) => new Date(Date.now() - ms).toISOString();

  function dispo(par: { storeId: string; presentationId: string }, stock: number, capturedAt: string) {
    return { captureId: randomUUID(), type: 'disponibilidad', contractVersion: '1.0', capturedAt, ...par, content: { stock } };
  }

  function precio(par: { storeId: string; presentationId: string }, price: number, capturedAt: string) {
    return {
      captureId: randomUUID(),
      type: 'precio_observado',
      contractVersion: '1.0',
      capturedAt,
      ...par,
      content: { price, lat: 25.6866, lng: -100.3161 },
    };
  }

  function lote(captures: unknown[]) {
    return { batchId: randomUUID(), deviceId: randomUUID(), contractVersion: '1.0', client: 'escritorio', captures };
  }

  const enviar = (l: unknown, correlacion = `it-destinos-${randomUUID()}`) =>
    http('POST', `${base}/v1/sync/batches`, { token: analista.token, json: l, correlacion });

  async function existencia(par: { storeId: string; presentationId: string }) {
    const r = await getJson(
      `${AVAILABILITY}/v1/availability/stock?storeId=${par.storeId}&presentationId=${par.presentationId}`,
      analista.token,
    );
    return r.data[0] as { stock: number; capturedAt: string } | undefined;
  }

  async function capturasDe(par: { storeId: string; presentationId: string }): Promise<number> {
    const r = await getJson(
      `${AVAILABILITY}/v1/availability/captures?storeId=${par.storeId}&presentationId=${par.presentationId}&limit=1`,
      analista.token,
    );
    return r.total;
  }

  const observaciones = async (): Promise<number> =>
    (await getJson(`${PRICING}/v1/price-observations?limit=1`, precios.token)).total;

  /** Busca una observación por id en la cola de pendientes (no hay GET por id). */
  async function observacionPendiente(id: string) {
    for (let page = 1; page < 200; page += 1) {
      const r = await getJson(`${PRICING}/v1/price-observations?status=pendiente&limit=100&page=${page}`, precios.token);
      const hallada = (r.data as Array<{ id: string; status?: string }>).find((o) => o.id === id);
      if (hallada) return hallada;
      if (page * 100 >= r.total) return null;
    }
    return null;
  }

  // Lo comparten los casos 1 y 2.
  const par = () => pares[0];
  let loteUno: ReturnType<typeof lote>;
  let stockUno: number;

  it('1. disponibilidad + precio → las dos aceptadas; la existencia cambió y hay una observación pendiente', async () => {
    stockUno = Math.floor(Math.random() * 900) + 10;
    const capturedAt = hace(60_000);
    loteUno = lote([dispo(par(), stockUno, capturedAt), precio(par(), 27.5, capturedAt)]);
    const correlacion = `it-destinos-${randomUUID()}`;

    const r = await enviar(loteUno, correlacion);
    expect(r.estado).toBe(200);
    // Con el reason: si algo no se acepta, la falla dice por qué.
    expect(r.cuerpo.results.map((x: { status: string; reason: unknown }) => [x.status, x.reason])).toEqual([
      ['aceptada', null],
      ['aceptada', null],
    ]);
    const [rDispo, rPrecio] = r.cuerpo.results;
    expect(rDispo.target).toEqual({ service: 'availability-service', id: rDispo.captureId });
    expect(rPrecio.target.service).toBe('pricing-service');

    // Viajaron el Authorization del usuario y el X-Correlation-Id del lote.
    for (const llamada of [...proxyAv.llamadas, ...proxyPr.llamadas]) {
      expect(llamada.headers.authorization).toBe(`Bearer ${analista.token}`);
      expect(llamada.headers['x-correlation-id']).toBe(correlacion);
    }

    const actual = await existencia(par());
    expect(actual?.stock).toBe(stockUno);
    expect(new Date(actual!.capturedAt).toISOString()).toBe(capturedAt);

    const obs = await observacionPendiente(rPrecio.target.id);
    expect(obs).not.toBeNull();
  });

  it('2. reenviar el MISMO lote → duplicada, y ni availability ni pricing tienen filas nuevas', async () => {
    const [capturasAntes, obsAntes] = await Promise.all([capturasDe(par()), observaciones()]);
    const llamadasAntes = proxyAv.llamadas.length + proxyPr.llamadas.length;

    const r = await enviar(loteUno);
    expect(r.estado).toBe(200);
    expect(r.cuerpo.resend).toBe(true);
    expect(r.cuerpo.results.map((x: { status: string; originalStatus: string }) => [x.status, x.originalStatus])).toEqual([
      ['duplicada', 'aceptada'],
      ['duplicada', 'aceptada'],
    ]);

    const [capturasDespues, obsDespues] = await Promise.all([capturasDe(par()), observaciones()]);
    expect(capturasDespues).toBe(capturasAntes);
    expect(obsDespues).toBe(obsAntes);
    expect((await existencia(par()))?.stock).toBe(stockUno);
    // Ni siquiera se llamó a los destinos: la idempotencia de sync lo resolvió.
    expect(proxyAv.llamadas.length + proxyPr.llamadas.length).toBe(llamadasAntes);
  });

  it('3. disponibilidad con capturedAt más viejo que el dato del destino → conflicto; la existencia no cambia', async () => {
    const parTres = pares[1];
    // Dato más reciente que NO pasó por sync (una corrección desde la web).
    const reciente = hace(10_000);
    const directa = await fetch(`${AVAILABILITY}/v1/availability/captures`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${analista.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...parTres, stock: 7, capturedAt: reciente, origin: 'web' }),
    });
    expect([201]).toContain(directa.status);
    const capturasAntes = await capturasDe(parTres);

    const r = await enviar(lote([dispo(parTres, 999, hace(3_600_000))]));
    expect(r.estado).toBe(200);
    const [res] = r.cuerpo.results;
    expect(res.status).toBe('conflicto');
    expect(res.serverCapturedAt).toBe(reciente);
    expect(res.reason.code).toBe('CONFLICT');
    expect(res.retryable).toBe(false);

    const actual = await existencia(parTres);
    expect(actual?.stock).toBe(7);
    expect(new Date(actual!.capturedAt).toISOString()).toBe(reciente);
    // La captura en conflicto queda en la bitácora del destino (no se pierde), sin tocar la existencia.
    expect(await capturasDe(parTres)).toBe(capturasAntes + 1);
  });

  it('4. destino apagado → no_disponible (retryable); al volver, el reenvío se procesa UNA sola vez', async () => {
    const parCuatro = pares[2];
    const stock = Math.floor(Math.random() * 900) + 10;
    const l = lote([dispo(parCuatro, stock, hace(30_000))]);
    const antes = await capturasDe(parCuatro);

    proxyAv.caido = true;
    const caido = await enviar(l);
    expect(caido.estado).toBe(200);
    expect(caido.cuerpo.results[0]).toMatchObject({
      status: 'rechazada',
      retryable: true,
      reason: { code: 'SERVICE_UNAVAILABLE' },
    });
    expect(await capturasDe(parCuatro)).toBe(antes);

    proxyAv.caido = false;
    const vuelta = await enviar(l);
    expect(vuelta.cuerpo.resend).toBe(true);
    expect(vuelta.cuerpo.results[0]).toMatchObject({ status: 'aceptada', retryable: false });
    expect(await capturasDe(parCuatro)).toBe(antes + 1);
    expect((await existencia(parCuatro))?.stock).toBe(stock);

    // Otro reenvío ya no la procesa: duplicada y sin filas nuevas.
    const otra = await enviar(l);
    expect(otra.cuerpo.results[0]).toMatchObject({ status: 'duplicada', originalStatus: 'aceptada' });
    expect(await capturasDe(parCuatro)).toBe(antes + 1);
  });

  it('GET /v1/health en JSON muestra el modo http y si availability y pricing responden', async () => {
    const r = await http('GET', `${base}/v1/health`);
    expect(r.cuerpo.destinos).toEqual({ modo: 'http', availability: 'ok', pricing: 'ok' });
    expect(r.cuerpo.checks).toEqual({ postgres: 'no configurado', mongodb: 'ok', redis: 'ok' });
    // En XML no va `destinos`: sigue validando contra health.xsd.
    const x = await http('GET', `${base}/v1/health`, { accept: 'application/xml' });
    expect(x.texto).not.toContain('destinos');
    expect(errorDeXsd(x.texto, HEALTH_XSD)).toBeNull();
  });
});
