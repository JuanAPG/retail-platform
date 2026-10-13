/**
 * Integración con MongoDB: POST → GET → read → unread, persistencia y
 * copia automática al Auditor (corre con Docker).
 *
 * Requiere `docker compose up -d mongodb redis auth-service
 * notifications-service` con seed. Los tokens salen del propio
 * auth-service:
 *
 *   npm run test:integracion
 */
const BASE = process.env.NOTIF_BASE_URL ?? 'http://localhost:3109';
const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';
/** Contraseña del seed, igual para todos (db/data_retail.sql). */
const CLAVE = process.env.SEED_PASSWORD ?? 'Passw0rd123!';

interface Identidad {
  token: string;
  userId: string;
  rol: string;
}

async function entrar(email: string): Promise<Identidad> {
  const respuesta = await fetch(`${AUTH}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  if (!respuesta.ok) throw new Error(`No se pudo entrar como ${email}: HTTP ${respuesta.status}.`);
  const { accessToken } = (await respuesta.json()) as { accessToken: string };
  const carga = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf-8')) as {
    sub: string;
    rol: string;
  };
  return { token: accessToken, userId: carga.sub, rol: carga.rol };
}

async function pedir(quien: Identidad, ruta: string, metodo: 'GET' | 'PATCH' | 'POST' = 'GET', cuerpo?: object) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${quien.token}` },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** Sufijo único por corrida: la ventana de dedup es de 5 minutos. */
const CORRIDA = Date.now().toString(36);

let precios: Identidad;
let auditor: Identidad;
let planeador: Identidad;

beforeAll(async () => {
  const salud = await fetch(`${BASE}/v1/health`).then((r) => r.json());
  // Sin Mongo estas pruebas no prueban lo que dicen.
  expect(salud.checks.mongodb).toBe('ok');
  [precios, auditor, planeador] = await Promise.all([
    entrar('precios@retail.mx'),
    entrar('auditor@retail.mx'),
    entrar('planeador@retail.mx'),
  ]);
  expect(auditor.rol).toBe('Auditor');
}, 45000);

describe('cuerpo XML (escritorio)', () => {
  it('POST con application/xml crea la notificación y responde XML', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><notificacionRequest xmlns="notif/v1"><eventType>precio.umbral</eventType><sourceService>pricing-service</sourceService><relatedEntityId>xml-${CORRIDA}</relatedEntityId><title>Precio fuera de rango</title><message>XML ${CORRIDA} A &amp; B</message></notificacionRequest>`;
    const r = await fetch(`${BASE}/v1/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml', Accept: 'application/xml', Authorization: `Bearer ${precios.token}` },
      body: xml,
    });
    expect(r.status).toBe(201);
    const cuerpo = await r.text();
    expect(cuerpo).toContain('<notificationResponse');
    expect(cuerpo).toContain(`XML ${CORRIDA} A &amp; B`);
  }, 30000);

  it('XML mal formado → 400 con el error estándar', async () => {
    const r = await fetch(`${BASE}/v1/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml', Authorization: `Bearer ${precios.token}` },
      body: '<notificacionRequest><title>x</notificacionRequest>',
    });
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe('VALIDATION_ERROR');
  }, 30000);
});

describe('notificaciones en MongoDB', () => {
  let principal: { id: string };
  let copia: { id: string };

  it('precio.umbral → 201 con id UUID, y un reintento no duplica (200)', async () => {
    const cuerpo = {
      eventType: 'precio.umbral',
      sourceService: 'pricing-service',
      relatedEntityId: `pres-${CORRIDA}`,
      title: 'Precio fuera de rango',
      message: `Umbral ${CORRIDA}.`,
      priority: 'warning',
    };
    const creada = await pedir(precios, '/v1/notifications', 'POST', cuerpo);
    expect(creada.estado).toBe(201);
    expect(creada.cuerpo.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    expect(creada.cuerpo.recipientRole).toBe('Responsable de precios');
    principal = creada.cuerpo;

    const otra = await pedir(precios, '/v1/notifications', 'POST', cuerpo);
    expect(otra.estado).toBe(200);
    expect(otra.cuerpo.id).toBe(principal.id);
  }, 30000);

  it('el Auditor recibe la copia (D-09) y el Planeador no ve nada', async () => {
    const bandeja = await pedir(auditor, '/v1/notifications?limit=100');
    expect(bandeja.estado).toBe(200);
    const suyas = (bandeja.cuerpo.data as { id: string; message: string; recipientRole: string }[]).filter(
      (n) => n.message === `Umbral ${CORRIDA}.`,
    );
    // Una sola copia aunque el emisor reintentó.
    expect(suyas).toHaveLength(1);
    expect(suyas[0].recipientRole).toBe('Auditor');
    copia = suyas[0];

    const ajena = await pedir(planeador, '/v1/notifications?limit=100');
    expect((ajena.cuerpo.data as { message: string }[]).some((n) => n.message === `Umbral ${CORRIDA}.`)).toBe(false);
  }, 30000);

  it('leer la copia descuenta del Auditor y no toca la principal', async () => {
    const antes = await pedir(auditor, '/v1/notifications/unread-count');
    const leida = await pedir(auditor, `/v1/notifications/${copia.id}/read`, 'PATCH');
    expect(leida.estado).toBe(200);
    expect(leida.cuerpo.readBy.map((m: { userId: string }) => m.userId)).toEqual([auditor.userId]);
    // Idempotente: marcar dos veces no agrega otra marca.
    const otraVez = await pedir(auditor, `/v1/notifications/${copia.id}/read`, 'PATCH');
    expect(otraVez.cuerpo.readBy).toHaveLength(1);
    const despues = await pedir(auditor, '/v1/notifications/unread-count');
    expect(despues.cuerpo.unread).toBe(antes.cuerpo.unread - 1);

    const original = await pedir(precios, `/v1/notifications/${principal.id}`);
    expect(original.cuerpo.readBy).toEqual([]);
  }, 30000);
});

// Marca el archivo como módulo: si no, sus `const` de nivel superior
// caen en el ámbito global y chocan con los del otro spec.
export {};
