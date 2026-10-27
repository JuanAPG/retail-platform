/**
 * D-28: el `Investigador de mercado` (app móvil) contra el servicio real.
 *
 *   docker compose up -d postgres redis pricing-service   # con el seed
 *   npm run test:integracion
 *
 * El usuario NO se inventa: se lee `investigador@retail.mx` del seed y se
 * firma el token con el nombre de rol que trae la base, así que si el rol se
 * sembró con otro acento esto truena aquí y no en la demo.
 *
 * Los 403 de otros servicios (recomendaciones, bitácora, transacciones) se
 * comprueban aquí mismo porque son parte de la misma decisión; si ese
 * servicio no está arriba, el caso se salta en vez de dar un falso rojo.
 */
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { Client } from 'pg';
import { crearPresentaciones, PresentacionPropia } from './fixtures';

const BASE = process.env.PRICING_BASE_URL ?? 'http://localhost:3103';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';

const OTROS = {
  decision: process.env.DECISION_BASE_URL ?? 'http://localhost:3107',
  audit: process.env.AUDIT_BASE_URL ?? 'http://localhost:3110',
  core: process.env.CORE_BASE_URL ?? 'http://localhost:3104',
};

const redis = new Redis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
});

function nuevaDb() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'retail_user',
    password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
    database: process.env.DB_NAME ?? 'retaildb',
  });
}

async function sesionDelSeed(db: Client, email: string) {
  const { rows } = await db.query<{ id: string; rol: string }>(
    'SELECT u.id, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.email = $1',
    [email],
  );
  if (!rows[0]) throw new Error(`El seed no tiene ${email}: ¿se recargó la base con data_retail.sql?`);
  await redis.set(`session:${rows[0].id}`, '1', 'EX', 1800);
  const token = sign(
    { sub: rows[0].id, email, rol: rows[0].rol, rolId: 1, jti: `jti-${rows[0].id}` },
    SECRET,
    { expiresIn: '30m' },
  );
  return { token, rol: rows[0].rol, id: rows[0].id };
}

async function pedir(base: string, metodo: string, ruta: string, token?: string, cuerpo?: object) {
  const respuesta = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await respuesta.text();
  return { estado: respuesta.status, cuerpo: texto ? JSON.parse(texto) : null };
}

const http = (metodo: string, ruta: string, token?: string, cuerpo?: object) =>
  pedir(BASE, metodo, ruta, token, cuerpo);

/** `null` si el servicio no está arriba: el caso se salta en vez de fallar. */
async function estadoEn(base: string, metodo: string, ruta: string, token: string, cuerpo?: object) {
  try {
    return (await pedir(base, metodo, ruta, token, cuerpo)).estado;
  } catch {
    return null;
  }
}

describe('Investigador de mercado en pricing-service (integración, requiere stack)', () => {
  let db: Client;
  let investigador: string;
  let investigadorId: string;
  let precios: string;
  let propias: PresentacionPropia[];

  beforeAll(async () => {
    db = nuevaDb();
    await db.connect();

    const sesion = await sesionDelSeed(db, 'investigador@retail.mx');
    investigador = sesion.token;
    investigadorId = sesion.id;
    // El nombre exacto importa: los guards comparan contra la constante ROL.
    expect(sesion.rol).toBe('Investigador de mercado');

    precios = (await sesionDelSeed(db, 'precios@retail.mx')).token;
    propias = await crearPresentaciones(db, 'inv-d28', 1);
  });

  afterAll(async () => {
    await db.query('DELETE FROM precios_observados WHERE capturado_por = $1', [investigadorId]).catch(() => undefined);
    await db.end();
    await redis.quit();
  });

  // ----------------------------------------------------------------- 201
  it('levanta un precio observado: 201, nace pendiente y NO cambia el vigente', async () => {
    const { presentacion_id, tienda_id } = propias[0];
    const observacion = {
      presentationId: presentacion_id,
      storeId: tienda_id,
      price: 31.5,
      observedAt: '2026-10-20T16:00:00Z',
      lat: 25.6866,
      lng: -100.3161,
    };

    const creada = await http('POST', '/v1/price-observations', investigador, observacion);
    expect(creada.estado).toBe(201);
    expect(creada.cuerpo).toMatchObject({
      status: 'pendiente',
      // D-16: la marca de origen ya la ponía el servicio para quien capturara.
      origin: 'observado_en_campo',
      capturedBy: investigadorId,
      priceId: null,
    });

    // Sigue siendo una propuesta: no hay precio vigente nuevo.
    const actual = await http(
      'GET',
      `/v1/prices/current?presentationId=${presentacion_id}&storeId=${tienda_id}`,
      precios,
    );
    expect(actual.cuerpo.data).toHaveLength(0);
  });

  it('la bitácora guarda el origen "observado en campo" con quién lo capturó (D-16)', async () => {
    // La bitácora se escribe por HTTP contra audit-service y es fire-and-forget:
    // si ese servicio no está arriba, la observación igual se crea (así está
    // definido) y aquí no hay nada que comprobar. Saltar, no fallar.
    const bitacoraArriba = await fetch(`${OTROS.audit}/v1/health`).then((r) => r.ok).catch(() => false);
    if (!bitacoraArriba) {
      console.warn('audit-service no responde: no se comprobó la marca de origen de D-16');
      return;
    }
    // El reporte es asíncrono: se le da un respiro antes de leer.
    await new Promise((r) => setTimeout(r, 2000));

    const { rows } = await db.query(
      `SELECT c.campo, c.valor_posterior
         FROM auditoria a JOIN auditoria_cambios c ON c.auditoria_id = a.id
        WHERE a.usuario_id = $1 AND a.servicio = 'pricing-service'
          AND c.campo IN ('origen', 'capturado_por')`,
      [investigadorId],
    );
    const porCampo = Object.fromEntries(rows.map((r) => [r.campo, r.valor_posterior]));
    expect(porCampo.origen).toBe('observado_en_campo');
    expect(porCampo.capturado_por).toBe(investigadorId);
  });

  // ----------------------------------------------------------------- 403
  it('no pone precios directos ni ve el histórico ni la comparación entre zonas', async () => {
    const alta = {
      presentationId: propias[0].presentacion_id,
      storeId: propias[0].tienda_id,
      price: 40,
      effectiveDate: '2026-10-20',
    };
    expect((await http('POST', '/v1/prices', investigador, alta)).estado).toBe(403);
    expect((await http('GET', '/v1/prices/history?limit=5', investigador)).estado).toBe(403);
    expect((await http('GET', '/v1/prices/current?limit=5', investigador)).estado).toBe(403);
  });

  it('no entra a las propuestas de precio del Proveedor ni aprueba nada', async () => {
    expect((await http('GET', '/v1/price-proposals', investigador)).estado).toBe(403);
    expect((await http('POST', '/v1/price-proposals', investigador, { price: 1 })).estado).toBe(403);
  });

  it('no lee la bandeja de observaciones: D-28 le da alta, no lectura', async () => {
    expect((await http('GET', '/v1/price-observations?status=pendiente', investigador)).estado).toBe(403);
  });

  // --------------------------------------------- 403 en otros servicios
  it('403 en recomendaciones, bitácora y transacciones (si esos servicios están arriba)', async () => {
    const casos: Array<[string, Promise<number | null>]> = [
      ['GET /v1/recommendations', estadoEn(OTROS.decision, 'GET', '/v1/recommendations', investigador)],
      ['GET /v1/auditoria', estadoEn(OTROS.audit, 'GET', '/v1/auditoria', investigador)],
      ['POST /v1/transactions', estadoEn(OTROS.core, 'POST', '/v1/transactions', investigador, { items: [] })],
    ];
    const resueltos = await Promise.all(casos.map(async ([ruta, p]) => [ruta, await p] as const));
    const arriba = resueltos.filter(([, estado]) => estado !== null);
    if (arriba.length === 0) {
      console.warn('decision, audit y core no respondieron: no se comprobaron los 403 cruzados');
      return;
    }
    for (const [ruta, estado] of arriba) expect([ruta, estado]).toEqual([ruta, 403]);
  });
});
