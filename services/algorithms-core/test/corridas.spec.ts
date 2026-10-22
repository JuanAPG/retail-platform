/**
 * ALG-10 (QA-ALG56-03): cada corrida deja su evento en la bitácora de
 * audit-service y avisa `corrida.terminada` a quien la lanzó.
 *
 * Requiere el stack con audit-service y notifications-service (y mongodb):
 *   docker compose -f infra/docker-compose.yml up -d postgres redis mongodb auth-service \
 *     catalog-service core-process-service audit-service notifications-service algorithms-core
 *   npm run test:integracion
 *
 * Borra las corridas que crea. Los eventos de la bitácora se quedan: es
 * append-only, nadie los borra.
 */
import { DataSource } from 'typeorm';
import databaseConfig from '../src/config/database.config';
import { CorridasMongo } from './corridas-mongo';

const BASE = process.env.ALGORITHMS_BASE_URL ?? 'http://localhost:3105';
const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';
const NOTIFICACIONES = process.env.NOTIFICATIONS_BASE_URL ?? 'http://localhost:3109';
const CLAVE = process.env.ALGORITHMS_TEST_PASSWORD ?? 'Passw0rd123!';

describe('Bitácora y aviso de corridas (integración, ALG-10)', () => {
  const opciones = databaseConfig() as { host: string; port: number; username: string; password: string; database: string };
  const db = new DataSource({
    type: 'postgres',
    host: opciones.host,
    port: opciones.port,
    username: opciones.username,
    password: opciones.password,
    database: opciones.database,
  });
  const mongo = new CorridasMongo();
  /** Elasticidad en Postgres; Apriori y FP-Growth en MongoDB (D3). */
  const creadas: string[] = [];
  const creadasMongo: string[] = [];

  async function entrar(email: string): Promise<{ token: string; id: string }> {
    const r = await fetch(`${AUTH}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: CLAVE }),
    });
    const token = ((await r.json()) as { accessToken: string }).accessToken;
    const [{ id }]: { id: string }[] = await db.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    return { token, id };
  }

  async function correr(ruta: string, token: string, cuerpo: object): Promise<string> {
    const r = await fetch(`${BASE}${ruta}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    expect(r.status).toBe(201);
    const json = (await r.json()) as { runId?: string } | { runId: string }[];
    const runId = Array.isArray(json) ? json[0]?.runId : json.runId;
    if (!runId) throw new Error(`${ruta} no devolvió runId (¿sin reglas? se necesitan ventas cargadas)`);
    (ruta.startsWith('/v1/association/') ? creadasMongo : creadas).push(runId);
    return runId;
  }

  /** El evento de la corrida en la bitácora, con sus cambios. */
  async function evento(runId: string, tabla = 'analisis_corridas') {
    const [e]: { id: number; servicio: string; accion: string; usuarioId: string }[] = await db.query(
      `SELECT id, servicio, accion::text AS accion, usuario_id AS "usuarioId"
       FROM auditoria WHERE tabla_afectada = $2 AND registro_id = $1`,
      [runId, tabla],
    );
    if (!e) return null;
    const cambios: { campo: string; posterior: string }[] = await db.query(
      'SELECT campo, valor_posterior AS posterior FROM auditoria_cambios WHERE auditoria_id = $1',
      [e.id],
    );
    return { ...e, cambios: Object.fromEntries(cambios.map((c) => [c.campo, c.posterior])) };
  }

  beforeAll(() => Promise.all([db.initialize(), mongo.abrir()]));

  afterAll(async () => {
    if (creadas.length > 0) await db.query('DELETE FROM analisis_corridas WHERE id = ANY($1::uuid[])', [creadas]);
    await mongo.borrar(creadasMongo);
    await Promise.all([db.destroy(), mongo.cerrar()]);
  });

  /** Aviso de la corrida en la bandeja de quien la lanzó. */
  async function aviso(token: string, runId: string) {
    const r = await fetch(`${NOTIFICACIONES}/v1/notifications?limit=100`, { headers: { Authorization: `Bearer ${token}` } });
    const bandeja = (await r.json()) as { data: { eventType: string; relatedEntityId: string; sourceService: string; title: string }[] };
    return bandeja.data.find((n) => n.relatedEntityId === runId);
  }

  it('una corrida de elasticidad deja su evento y avisa corrida.terminada al Responsable de precios', async () => {
    const precios = await entrar(process.env.ELASTICIDAD_TEST_EMAIL ?? 'precios@retail.mx');

    const runId = await correr('/v1/elasticity/calculate', precios.token, {});

    expect(await evento(runId)).toMatchObject({
      servicio: 'algorithms-core',
      accion: 'ejecutar_corrida',
      usuarioId: precios.id,
      cambios: { tipo: 'elasticidad', estado: 'completada' },
    });
    // Desde #61 notifications-service acepta al Responsable de precios como origen.
    expect(await aviso(precios.token, runId)).toMatchObject({ eventType: 'corrida.terminada', sourceService: 'algorithms-core' });
  });

  it.each([
    ['Apriori', '/v1/association/apriori/run'],
    ['FP-Growth', '/v1/association/fpgrowth/run'],
  ])('una corrida de %s deja su evento y avisa corrida.terminada a quien la lanzó', async (nombre, ruta) => {
    const analista = await entrar(process.env.ALGORITHMS_TEST_EMAIL ?? 'analista@retail.mx');

    const runId = await correr(ruta, analista.token, { minSupport: 0.01, minConfidence: 0.01 });

    // D3: la corrida vive en la colección `analysis_runs` de Mongo.
    expect(await evento(runId, 'analysis_runs')).toMatchObject({
      servicio: 'algorithms-core',
      usuarioId: analista.id,
      cambios: { tipo: 'asociacion', estado: 'completada' },
    });
    expect(await aviso(analista.token, runId)).toMatchObject({
      eventType: 'corrida.terminada',
      sourceService: 'algorithms-core',
      title: `${nombre}: corrida terminada`,
    });
  });
});
