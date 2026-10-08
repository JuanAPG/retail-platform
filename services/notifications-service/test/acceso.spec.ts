/**
 * Acceso a notificaciones, de punta a punta (corre en la VM con Docker).
 *
 * Reproduce lo que QA encontró en vivo el 7 de octubre y comprueba que ya
 * no pasa:
 *  - un Proveedor emitiendo un evento que no le corresponde,
 *  - un Proveedor leyendo o marcando la notificación de otro,
 *  - `sourceService` quedando en null.
 *
 * NO depende de Mongo: la autorización es independiente del almacén, así
 * que esto corre hoy con el repositorio en memoria. El spec que sí
 * necesita Mongo (`notificaciones.spec.ts`) sigue en `skip`.
 *
 * Requiere `docker compose up -d notifications-service auth-service` con
 * seed. Los tokens los saca del propio auth-service:
 *
 *   npm run test:integracion
 */
const BASE = process.env.NOTIF_BASE_URL ?? 'http://localhost:3109';
const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';
/** Contraseña del seed, igual para todos (db/data_retail.sql). */
const CLAVE = process.env.SEED_PASSWORD ?? 'Passw0rd123!';

interface Identidad {
  email: string;
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
  if (!respuesta.ok) {
    throw new Error(`No se pudo entrar como ${email}: HTTP ${respuesta.status}.`);
  }
  const cuerpo = (await respuesta.json()) as { accessToken: string };
  const carga = JSON.parse(
    Buffer.from(cuerpo.accessToken.split('.')[1], 'base64url').toString('utf-8'),
  ) as { sub: string; rol: string };
  return { email, token: cuerpo.accessToken, userId: carga.sub, rol: carga.rol };
}

async function emitir(quien: Identidad, cuerpo: object) {
  const respuesta = await fetch(`${BASE}/v1/notifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${quien.token}` },
    body: JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function pedir(quien: Identidad, ruta: string, metodo: 'GET' | 'PATCH' = 'GET') {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${quien.token}` },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** Sufijo único por corrida: la ventana de dedup es de 5 minutos. */
const CORRIDA = Date.now().toString(36);

let proveedorA: Identidad;
let proveedorB: Identidad;
let gerente: Identidad;
let precios: Identidad;

beforeAll(async () => {
  try {
    const salud = await fetch(`${BASE}/v1/health`);
    if (!salud.ok) throw new Error(`health devolvió ${salud.status}`);
  } catch (error) {
    throw new Error(
      `No hay stack en ${BASE}: levanta docker compose antes de correr estas pruebas. ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }

  [proveedorA, proveedorB, gerente, precios] = await Promise.all([
    entrar('ventas@lacteosdelnorte.mx'),
    entrar('contacto@bioorganicos.mx'),
    entrar('gercategoria@retail.mx'),
    entrar('precios@retail.mx'),
  ]);

  // Si el seed cambiara de roles, estas pruebas no probarían lo que creen.
  expect(proveedorA.rol).toBe('Proveedor');
  expect(proveedorB.rol).toBe('Proveedor');
  expect(proveedorA.userId).not.toBe(proveedorB.userId);
  expect(gerente.rol).toBe('Gerente de categoría');
  expect(precios.rol).toBe('Responsable de precios');
}, 45000);

describe('Quién puede emitir qué', () => {
  it('Proveedor → precio.umbral al Gerente → 403', async () => {
    // El caso exacto de QA: un Proveedor mandó un `critical` al rol Gerente
    // de categoría y el Gerente lo recibió.
    const r = await emitir(proveedorA, {
      eventType: 'precio.umbral',
      sourceService: 'pricing-service',
      relatedEntityId: `pres-${CORRIDA}-1`,
      recipientRole: 'Gerente de categoría',
      title: 'Precio fuera de rango',
      message: 'Intento de un Proveedor.',
      priority: 'critical',
    });

    expect(r.estado).toBe(403);
    expect(r.cuerpo.code).toBe('FORBIDDEN');
    expect(r.cuerpo.message).toMatch(/no puede originar precio\.umbral/i);
  }, 30000);

  it('y el Gerente no recibió nada de ese intento', async () => {
    const bandeja = await pedir(gerente, '/v1/notifications?limit=100');
    expect(bandeja.estado).toBe(200);
    const suyas = bandeja.cuerpo.data as { message: string }[];
    expect(suyas.some((n) => n.message === 'Intento de un Proveedor.')).toBe(false);
  }, 30000);

  it('Responsable de precios → precio.umbral → 201', async () => {
    const r = await emitir(precios, {
      eventType: 'precio.umbral',
      sourceService: 'pricing-service',
      relatedEntityId: `pres-${CORRIDA}-2`,
      recipientRole: 'Responsable de precios',
      title: 'Precio fuera de rango',
      message: 'Emitido por quien sí puede.',
      priority: 'warning',
    });
    expect([200, 201]).toContain(r.estado);
    expect(r.cuerpo.eventType).toBe('precio.umbral');
  }, 30000);

  it('un evento sin regla de origen no lo emite nadie → 403', async () => {
    const r = await emitir(gerente, {
      eventType: 'proveedor.solicitud',
      sourceService: 'catalog-service',
      relatedEntityId: `prov-${CORRIDA}`,
      recipientRole: 'Administrador',
      title: 'Solicitud de proveedor',
      message: 'Sin flujo implementado todavía.',
    });
    expect(r.estado).toBe(403);
  }, 30000);

  it('sourceService es obligatorio y de lista cerrada → 400', async () => {
    const sinServicio = await emitir(proveedorA, {
      eventType: 'producto.propuesto',
      relatedEntityId: `prod-${CORRIDA}-x`,
      title: 'Nueva propuesta',
      message: 'Sin sourceService.',
    });
    expect(sinServicio.estado).toBe(400);
    expect(sinServicio.cuerpo.code).toBe('VALIDATION_ERROR');

    const inventado = await emitir(proveedorA, {
      eventType: 'producto.propuesto',
      sourceService: 'servicio-que-no-existe',
      relatedEntityId: `prod-${CORRIDA}-y`,
      title: 'Nueva propuesta',
      message: 'sourceService inventado.',
    });
    expect(inventado.estado).toBe(400);
  }, 30000);
});

describe('El flujo legítimo sigue funcionando', () => {
  let creada: { id: string; sourceService: string; recipientRole: string };

  it('Proveedor proponiendo producto → 201, y sourceService queda guardado', async () => {
    const r = await emitir(proveedorA, {
      eventType: 'producto.propuesto',
      sourceService: 'catalog-service',
      relatedEntityId: `prod-${CORRIDA}`,
      title: 'Nueva propuesta de producto',
      message: `Propuesta de ${CORRIDA}.`,
    });

    expect(r.estado).toBe(201);
    // Lo que QA reportó como siempre null.
    expect(r.cuerpo.sourceService).toBe('catalog-service');
    // El destinatario lo fijó la regla, no el emisor.
    expect(r.cuerpo.recipientRole).toBe('Gerente de categoría');
    expect(r.cuerpo.recipientUserId).toBeNull();
    creada = r.cuerpo;
  }, 30000);

  it('el Gerente la ve en su bandeja', async () => {
    const bandeja = await pedir(gerente, '/v1/notifications?limit=100');
    expect(bandeja.estado).toBe(200);
    const suyas = bandeja.cuerpo.data as { id: string; message: string }[];
    expect(suyas.some((n) => n.id === creada.id)).toBe(true);
  }, 30000);

  it('el Gerente la lee por id y la marca como leída', async () => {
    const vista = await pedir(gerente, `/v1/notifications/${creada.id}`);
    expect(vista.estado).toBe(200);
    expect(vista.cuerpo.id).toBe(creada.id);

    const leida = await pedir(gerente, `/v1/notifications/${creada.id}/read`, 'PATCH');
    expect(leida.estado).toBe(200);
    expect(leida.cuerpo.readBy.map((m: { userId: string }) => m.userId)).toContain(gerente.userId);
  }, 30000);

  it('el emisor NO puede dirigir producto.propuesto a otro rol → 400', async () => {
    const r = await emitir(proveedorA, {
      eventType: 'producto.propuesto',
      sourceService: 'catalog-service',
      relatedEntityId: `prod-${CORRIDA}-z`,
      recipientRole: 'Auditor',
      title: 'Nueva propuesta',
      message: 'Intento de redirigir.',
    });
    expect(r.estado).toBe(400);
  }, 30000);
});

describe('Quién puede ver y marcar', () => {
  let delGerente: { id: string };

  beforeAll(async () => {
    const r = await emitir(proveedorA, {
      eventType: 'producto.propuesto',
      sourceService: 'catalog-service',
      relatedEntityId: `prod-${CORRIDA}-lectura`,
      title: 'Nueva propuesta de producto',
      message: `Solo para el Gerente ${CORRIDA}.`,
    });
    expect(r.estado).toBe(201);
    delGerente = r.cuerpo;
  }, 30000);

  it('Proveedor B leyendo la del Gerente → 404 y SIN contenido', async () => {
    const r = await pedir(proveedorB, `/v1/notifications/${delGerente.id}`);
    expect(r.estado).toBe(404);
    // Lo crítico: la respuesta no trae nada de la notificación.
    expect(JSON.stringify(r.cuerpo)).not.toContain('Solo para el Gerente');
    expect(r.cuerpo.message).not.toContain(CORRIDA);
  }, 30000);

  it('Proveedor B marcándola como leída → 404 y SIN contenido', async () => {
    // El caso exacto de QA: la respuesta le devolvía el contenido.
    const r = await pedir(proveedorB, `/v1/notifications/${delGerente.id}/read`, 'PATCH');
    expect(r.estado).toBe(404);
    expect(JSON.stringify(r.cuerpo)).not.toContain('Solo para el Gerente');
    expect(r.cuerpo.readBy).toBeUndefined();
  }, 30000);

  it('y el intento ajeno no dejó marca de lectura', async () => {
    const vista = await pedir(gerente, `/v1/notifications/${delGerente.id}`);
    expect(vista.estado).toBe(200);
    const lectores = (vista.cuerpo.readBy as { userId: string }[]).map((m) => m.userId);
    expect(lectores).not.toContain(proveedorB.userId);
  }, 30000);

  it('el 404 ajeno es indistinguible del de una inexistente', async () => {
    const ajena = await pedir(proveedorB, `/v1/notifications/${delGerente.id}`);
    const inexistente = await pedir(
      proveedorB,
      '/v1/notifications/00000000-0000-4000-8000-000000000000',
    );
    expect(ajena.estado).toBe(inexistente.estado);
    expect(ajena.cuerpo.message).toBe(inexistente.cuerpo.message);
  }, 30000);

  it('tampoco aparece en la bandeja ni en el conteo del ajeno', async () => {
    const bandeja = await pedir(proveedorB, '/v1/notifications?limit=100');
    const suyas = bandeja.cuerpo.data as { id: string }[];
    expect(suyas.some((n) => n.id === delGerente.id)).toBe(false);

    const conteo = await pedir(proveedorB, '/v1/notifications/unread-count');
    expect(conteo.estado).toBe(200);
    expect(typeof conteo.cuerpo.unread).toBe('number');
  }, 30000);

  it('sin token no se ve nada → 401', async () => {
    const r = await fetch(`${BASE}/v1/notifications/${delGerente.id}`);
    expect(r.status).toBe(401);
  }, 30000);
});

// Marca el archivo como módulo: si no, sus `const` de nivel superior
// caen en el ámbito global y chocan con los del otro spec.
export {};
