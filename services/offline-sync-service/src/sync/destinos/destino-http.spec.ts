import { CapturaEntrada } from '../tipos';
import { ContextoEnvio } from './destino';
import { configDestino, DestinoHttp, saludDestino } from './destino-http';

/**
 * DestinoHttp con HTTP SIMULADO (un `fetch` falso): cada fila de la tabla de
 * mapeo del contrato §6, timeout, red, 5xx, encabezados y lat/lng.
 */

const AV = 'http://availability.prueba:3114';
const PR = 'http://pricing.prueba:3103/';
const CAPTURA = 'c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11';
const TIENDA = '27f05c81-c6bf-456a-a273-150e4edb9900';
const PRES = '5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77';
const OBS = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';

const CTX: ContextoEnvio = {
  token: 'Bearer eyJ.token.secreto',
  correlationId: 'corr-123',
  userId: 'usuario-1',
  client: 'movil',
};

function dispo(parcial: Partial<CapturaEntrada> = {}): CapturaEntrada {
  return {
    captureId: CAPTURA,
    type: 'disponibilidad',
    contractVersion: '1.0',
    capturedAt: '2026-10-26T09:30:00-06:00',
    storeId: TIENDA,
    presentationId: PRES,
    content: { stock: 12 },
    ...parcial,
  };
}

function precio(content: CapturaEntrada['content'] = { price: 27.5, lat: 25.6866, lng: -100.3161 }): CapturaEntrada {
  return dispo({ type: 'precio_observado', content });
}

interface Llamada {
  url: string;
  init: RequestInit;
  cuerpo: Record<string, unknown>;
  headers: Record<string, string>;
}

/** `fetch` falso: responde `estado` con `cuerpo` y guarda cada llamada. */
function falso(estado: number, cuerpo: unknown = null) {
  const llamadas: Llamada[] = [];
  const f = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({
      url: String(url),
      init: init ?? {},
      cuerpo: JSON.parse(String(init?.body ?? '{}')),
      headers: init?.headers as Record<string, string>,
    });
    return new Response(cuerpo === null ? '' : JSON.stringify(cuerpo), {
      status: estado,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { f: f as unknown as typeof fetch, llamadas };
}

function destino(f: typeof fetch, timeoutMs?: number) {
  return new DestinoHttp({ availabilityUrl: AV, pricingUrl: PR, fetch: f, timeoutMs });
}

const capturaRespuesta = (status: string, extra: Record<string, unknown> = {}) => ({
  captureId: CAPTURA,
  status,
  storeId: TIENDA,
  presentationId: PRES,
  stock: 12,
  capturedAt: '2026-10-26T15:30:00.000Z',
  currentCapturedAt: '2026-10-26T15:30:00.000Z',
  reason: null,
  ...extra,
});

describe('DestinoHttp · disponibilidad → availability-service', () => {
  it('envía el cuerpo del contrato a POST /v1/availability/captures, con origin = client del lote', async () => {
    const { f, llamadas } = falso(201, capturaRespuesta('aceptada'));
    await destino(f).enviar(dispo(), { ...CTX, client: 'escritorio' });
    expect(llamadas[0].url).toBe(`${AV}/v1/availability/captures`);
    expect(llamadas[0].init.method).toBe('POST');
    expect(llamadas[0].cuerpo).toEqual({
      captureId: CAPTURA,
      storeId: TIENDA,
      presentationId: PRES,
      stock: 12,
      capturedAt: '2026-10-26T09:30:00-06:00',
      origin: 'escritorio',
    });
  });

  it('201 aceptada → aceptada, target availability-service con el captureId', async () => {
    const { f } = falso(201, capturaRespuesta('aceptada'));
    expect(await destino(f).enviar(dispo(), CTX)).toEqual({
      resultado: 'aceptada',
      target: { service: 'availability-service', id: CAPTURA },
    });
  });

  it('201 conflicto → conflicto con serverCapturedAt = currentCapturedAt y el reason del destino', async () => {
    const reason = 'El servidor ya tiene un dato capturado después (2026-10-28T16:00:00.000Z): esta captura no lo sobrescribe (D-42).';
    const { f } = falso(201, capturaRespuesta('conflicto', { currentCapturedAt: '2026-10-28T16:00:00Z', reason }));
    expect(await destino(f).enviar(dispo(), CTX)).toEqual({
      resultado: 'conflicto',
      target: { service: 'availability-service', id: CAPTURA },
      serverCapturedAt: '2026-10-28T16:00:00.000Z',
      message: reason,
    });
  });

  it('200 duplicada de una captura que fue ACEPTADA → aceptada (resultado original)', async () => {
    const { f } = falso(
      200,
      capturaRespuesta('duplicada', { reason: 'Captura ya recibida (aceptada); no se registró de nuevo (D-42).' }),
    );
    expect(await destino(f).enviar(dispo(), CTX)).toEqual({
      resultado: 'aceptada',
      target: { service: 'availability-service', id: CAPTURA },
    });
  });

  it('200 duplicada de una captura que fue CONFLICTO → conflicto con la fecha del dato vigente', async () => {
    const { f } = falso(
      200,
      capturaRespuesta('duplicada', {
        currentCapturedAt: '2026-10-28T16:00:00.000Z',
        reason: 'Captura ya recibida (conflicto); no se registró de nuevo (D-42).',
      }),
    );
    const r = await destino(f).enviar(dispo(), CTX);
    expect(r).toMatchObject({ resultado: 'conflicto', serverCapturedAt: '2026-10-28T16:00:00.000Z' });
    expect((r as { message: string }).message).toMatch(/más reciente que esta captura/);
  });

  it('200 con originalStatus (si availability lo agrega) gana sobre el texto de reason', async () => {
    const { f } = falso(200, capturaRespuesta('duplicada', { originalStatus: 'aceptada', reason: 'otro texto' }));
    expect(await destino(f).enviar(dispo(), CTX)).toMatchObject({ resultado: 'aceptada' });
  });

  it('200 sin resultado original reconocible → rechazada INTERNAL (no adivina)', async () => {
    const { f } = falso(200, capturaRespuesta('duplicada', { reason: 'texto que cambió' }));
    expect(await destino(f).enviar(dispo(), CTX)).toMatchObject({ resultado: 'rechazada', code: 'INTERNAL' });
  });

  it.each([
    [400, 'VALIDATION_ERROR', 'La tienda o la presentación no existen.'],
    [403, 'FORBIDDEN', 'No tienes permiso.'],
    [409, 'CONFLICT', 'Ese captureId ya fue usado por otra captura.'],
  ])('%i → rechazada %s con el mensaje del destino', async (estado, code, message) => {
    const { f } = falso(estado, { statusCode: estado, message, code: 'X', details: null });
    expect(await destino(f).enviar(dispo(), CTX)).toEqual({ resultado: 'rechazada', code, message });
  });

  it('400 con details: el detalle va en el mensaje', async () => {
    const { f } = falso(400, { message: 'La petición no pasó la validación.', details: ['stock must not be less than 0'] });
    expect(await destino(f).enviar(dispo(), CTX)).toEqual({
      resultado: 'rechazada',
      code: 'VALIDATION_ERROR',
      message: 'La petición no pasó la validación. stock must not be less than 0',
    });
  });
});

describe('DestinoHttp · precio_observado → pricing-service', () => {
  it('envía observationId = captureId, observedAt = capturedAt y lat/lng cuando vienen las dos', async () => {
    const { f, llamadas } = falso(201, { id: OBS });
    await destino(f).enviar(precio(), CTX);
    expect(llamadas[0].url).toBe(`${PR}v1/price-observations`);
    expect(llamadas[0].cuerpo).toEqual({
      observationId: CAPTURA,
      presentationId: PRES,
      storeId: TIENDA,
      price: 27.5,
      observedAt: '2026-10-26T09:30:00-06:00',
      lat: 25.6866,
      lng: -100.3161,
    });
  });

  it.each([
    ['sin lat ni lng', { price: 27.5 }],
    ['solo lat', { price: 27.5, lat: 25.6866 }],
    ['solo lng', { price: 27.5, lng: -100.3161 }],
  ])('%s → no manda ninguna de las dos', async (_caso, content) => {
    const { f, llamadas } = falso(201, { id: OBS });
    await destino(f).enviar(precio(content), CTX);
    expect(llamadas[0].cuerpo).not.toHaveProperty('lat');
    expect(llamadas[0].cuerpo).not.toHaveProperty('lng');
  });

  it('201 → aceptada con el id de la observación creada', async () => {
    const { f } = falso(201, { id: OBS, status: 'pendiente' });
    expect(await destino(f).enviar(precio(), CTX)).toEqual({
      resultado: 'aceptada',
      target: { service: 'pricing-service', id: OBS },
    });
  });

  it('200 (mismo observationId, mismo usuario) → aceptada con el id de la observación ORIGINAL', async () => {
    const original = '11111111-2222-4333-8444-555555555555';
    const { f } = falso(200, { id: original, status: 'pendiente' });
    expect(await destino(f).enviar(precio(), CTX)).toEqual({
      resultado: 'aceptada',
      target: { service: 'pricing-service', id: original },
    });
  });

  it.each([
    [400, 'VALIDATION_ERROR', 'observationId debe ser un UUID v4.'],
    [403, 'FORBIDDEN', 'No tienes permiso.'],
    [409, 'CONFLICT', 'Ese observationId ya se usó en otra captura. Genera uno nuevo en el dispositivo.'],
    [409, 'CONFLICT', 'El producto no está activo: no se le pueden levantar precios.'],
  ])('%i → rechazada %s con el mensaje de pricing (%s)', async (estado, code, message) => {
    const { f } = falso(estado, { statusCode: estado, message, code: 'CONFLICT', details: null });
    expect(await destino(f).enviar(precio(), CTX)).toEqual({ resultado: 'rechazada', code, message });
  });

  it('201 sin id → rechazada INTERNAL', async () => {
    const { f } = falso(201, {});
    expect(await destino(f).enviar(precio(), CTX)).toMatchObject({ resultado: 'rechazada', code: 'INTERNAL' });
  });
});

describe('DestinoHttp · común a los dos destinos', () => {
  it.each(['disponibilidad', 'precio_observado'] as const)(
    '%s: viajan Authorization del usuario y X-Correlation-Id del lote',
    async (tipo) => {
      const { f, llamadas } = falso(201, tipo === 'disponibilidad' ? capturaRespuesta('aceptada') : { id: OBS });
      await destino(f).enviar(tipo === 'disponibilidad' ? dispo() : precio(), CTX);
      expect(llamadas[0].headers.Authorization).toBe('Bearer eyJ.token.secreto');
      expect(llamadas[0].headers['X-Correlation-Id']).toBe('corr-123');
      expect(llamadas[0].headers['Content-Type']).toBe('application/json');
    },
  );

  it('un token sin el prefijo Bearer se manda con él', async () => {
    const { f, llamadas } = falso(201, { id: OBS });
    await destino(f).enviar(precio(), { ...CTX, token: 'eyJ.solo' });
    expect(llamadas[0].headers.Authorization).toBe('Bearer eyJ.solo');
  });

  it.each([500, 502, 503, 504])('%i → no_disponible (reintentable)', async (estado) => {
    const { f } = falso(estado, { message: 'caído' });
    for (const c of [dispo(), precio()]) {
      const r = await destino(f).enviar(c, CTX);
      expect(r.resultado).toBe('no_disponible');
      expect((r as { message: string }).message).toMatch(/Reintenta el lote/);
    }
  });

  it('401 (sesión vencida en el destino) → no_disponible: nada se aplicó y reenviar es seguro', async () => {
    const { f } = falso(401, { message: 'Sesión inactiva.' });
    expect(await destino(f).enviar(dispo(), CTX)).toMatchObject({ resultado: 'no_disponible' });
  });

  it('404 (URL o ruta equivocada) → no_disponible', async () => {
    const { f } = falso(404, { message: 'Cannot POST' });
    expect(await destino(f).enviar(precio(), CTX)).toMatchObject({ resultado: 'no_disponible' });
  });

  it('otro 4xx inesperado (422) → rechazada INTERNAL', async () => {
    const { f } = falso(422, { message: 'raro' });
    expect(await destino(f).enviar(precio(), CTX)).toMatchObject({ resultado: 'rechazada', code: 'INTERNAL' });
  });

  it('error de red → no_disponible con el nombre del servicio', async () => {
    const f = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await destino(f).enviar(dispo(), CTX)).toEqual({
      resultado: 'no_disponible',
      message: 'availability-service no responde (fetch failed). Reintenta el lote.',
    });
  });

  it('timeout: un destino que no responde a tiempo → no_disponible, sin esperar de más', async () => {
    // Respeta la señal de aborto, como el fetch real.
    const f = jest.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_ok, fallar) => {
          init?.signal?.addEventListener('abort', () => fallar(init.signal?.reason));
        }),
    ) as unknown as typeof fetch;
    const inicio = Date.now();
    const r = await destino(f, 100).enviar(precio(), CTX);
    expect(r).toEqual({ resultado: 'no_disponible', message: 'pricing-service no respondió en 100 ms. Reintenta el lote.' });
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  it('el timeout por defecto es de 3 s', async () => {
    const f = jest.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_ok, fallar) => init?.signal?.addEventListener('abort', () => fallar(init.signal?.reason))),
    ) as unknown as typeof fetch;
    const inicio = Date.now();
    const r = await destino(f).enviar(dispo(), CTX);
    const ms = Date.now() - inicio;
    expect(r).toEqual({ resultado: 'no_disponible', message: 'availability-service no respondió en 3 s. Reintenta el lote.' });
    expect(ms).toBeGreaterThanOrEqual(2900);
    expect(ms).toBeLessThan(4500);
  }, 10_000);

  it('nunca registra el token en el log', async () => {
    const espia = jest.spyOn(require('@nestjs/common').Logger.prototype, 'log').mockImplementation(() => undefined);
    const { f } = falso(201, { id: OBS });
    await destino(f).enviar(precio(), CTX);
    const escrito = espia.mock.calls.map((c) => JSON.stringify(c)).join(' ');
    expect(escrito).toContain('corr-123');
    expect(escrito).not.toContain('eyJ.token.secreto');
    espia.mockRestore();
  });
});

describe('configDestino (SYNC_DESTINO)', () => {
  const urls = { AVAILABILITY_SERVICE_URL: AV, PRICING_SERVICE_URL: PR };

  it('por defecto es http y exige las dos URLs', () => {
    expect(configDestino({ ...urls })).toEqual({ modo: 'http', availabilityUrl: AV, pricingUrl: PR });
  });

  it.each([
    [{ PRICING_SERVICE_URL: PR }, /AVAILABILITY_SERVICE_URL/],
    [{ AVAILABILITY_SERVICE_URL: AV }, /PRICING_SERVICE_URL/],
    [{}, /AVAILABILITY_SERVICE_URL y PRICING_SERVICE_URL/],
    [{ AVAILABILITY_SERVICE_URL: '  ', PRICING_SERVICE_URL: PR }, /AVAILABILITY_SERVICE_URL/],
  ])('http sin una URL → no arranca y dice cuál falta (%o)', (entorno, falta) => {
    expect(() => configDestino({ SYNC_DESTINO: 'http', ...entorno })).toThrow(falta);
  });

  it('URL inválida → no arranca', () => {
    expect(() => configDestino({ ...urls, PRICING_SERVICE_URL: 'pricing:3103' })).toThrow(/PRICING_SERVICE_URL no es una URL válida/);
  });

  it('simulado no pide URLs; otro valor no arranca', () => {
    expect(configDestino({ SYNC_DESTINO: 'simulado' })).toEqual({ modo: 'simulado', availabilityUrl: null, pricingUrl: null });
    expect(() => configDestino({ SYNC_DESTINO: 'real', ...urls })).toThrow(/"http" o "simulado"/);
  });
});

describe('saludDestino', () => {
  it('ok si el health del destino dice ok; error con el motivo si no', async () => {
    expect(await saludDestino(AV, 2000, falso(200, { status: 'ok' }).f)).toBe('ok');
    expect(await saludDestino(AV, 2000, falso(200, { status: 'degraded' }).f)).toBe('error: degraded');
    expect(await saludDestino(AV, 2000, falso(503, null).f)).toBe('error: HTTP 503');
    const caido = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await saludDestino(AV, 2000, caido)).toBe('error: fetch failed');
  });
});
