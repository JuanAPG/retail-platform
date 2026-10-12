/**
 * Integración de FP-Growth (RF-14, D2): con los mismos datos y umbrales,
 * `fpgrowth/run` devuelve las mismas reglas que `apriori/run`, con las
 * mismas métricas y en el mismo orden, y cada corrida guarda su
 * `algoritmo`. Se compara la respuesta tal como llega, sin ordenarla.
 * Borra las corridas que crea.
 *
 *   docker compose -f infra/docker-compose.yml up -d postgres redis auth-service algorithms-core
 *   npm run test:integracion
 */
import { DataSource } from 'typeorm';
import { ReglaConProductos } from '../src/association/association.service';
import databaseConfig from '../src/config/database.config';

const BASE = process.env.ALGORITHMS_BASE_URL ?? 'http://localhost:3105';
const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';
const CLAVE = process.env.ALGORITHMS_TEST_PASSWORD ?? 'Passw0rd123!';

type Algoritmo = 'apriori' | 'fpgrowth';

/** Lo que debe coincidir: productos de cada lado y métricas, en el orden de la respuesta. */
const firma = (reglas: ReglaConProductos[]) =>
  reglas.map((r) => ({
    items: r.items.map((i) => `${i.side}:${i.productId}`),
    support: r.support,
    confidence: r.confidence,
    lift: r.lift,
    transactionCount: r.transactionCount,
  }));

describe('FP-Growth (integración, requiere stack y ventas cargadas)', () => {
  const opciones = databaseConfig() as { host: string; port: number; username: string; password: string; database: string };
  const db = new DataSource({
    type: 'postgres',
    host: opciones.host,
    port: opciones.port,
    username: opciones.username,
    password: opciones.password,
    database: opciones.database,
  });
  const creadas = new Set<string>();
  let analista = '';

  async function entrar(email: string): Promise<string> {
    const r = await fetch(`${AUTH}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: CLAVE }),
    });
    return ((await r.json()) as { accessToken: string }).accessToken;
  }

  async function correr(algoritmo: Algoritmo, cuerpo: object): Promise<ReglaConProductos[]> {
    const r = await fetch(`${BASE}/v1/association/${algoritmo}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${analista}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const json = (await r.json()) as ReglaConProductos[] & { message?: string };
    if (r.status !== 201) throw new Error(`${algoritmo}/run respondió ${r.status}: ${json.message}`);
    // Sin reglas no hay runId para borrar la corrida: los umbrales de abajo siempre dan reglas.
    if (json.length === 0) throw new Error(`${algoritmo}/run no dio reglas (se necesitan ventas cargadas)`);
    for (const regla of json) creadas.add(regla.runId);
    return json;
  }

  beforeAll(async () => {
    await db.initialize();
    analista = await entrar(process.env.ALGORITHMS_TEST_EMAIL ?? 'analista@retail.mx');
  });

  afterAll(async () => {
    if (creadas.size > 0) await db.query('DELETE FROM analisis_corridas WHERE id = ANY($1::uuid[])', [[...creadas]]);
    await db.destroy();
  });

  // En el CSV de 100 canastas solo una lleva 3 productos: con soporte 0.005
  // basta una canasta, y así también se comparan reglas de 3 productos.
  it.each([
    { minSupport: 0.005, minConfidence: 0.01 },
    { minSupport: 0.02, minConfidence: 0.3, maxItemsetSize: 4 },
    { minSupport: 0.05, minConfidence: 0.2, maxItemsetSize: 2 },
  ])('mismas reglas, métricas y orden que Apriori con %j', async (cuerpo) => {
    const deApriori = await correr('apriori', cuerpo);
    const deFpGrowth = await correr('fpgrowth', cuerpo);

    expect(firma(deFpGrowth)).toEqual(firma(deApriori));
  });

  // Los empates no se buscan aquí: al responder, las reglas se releen de la
  // base y se ordenan con compararReglas, el mismo código para los dos
  // algoritmos. Los cubren test/apriori.spec.ts (ALG-06) y la prueba
  // unitaria de 300 casos (src/association/fpgrowth.spec.ts).
  it('no pasa en vacío: con soporte 0.005 hay reglas de 3 productos', async () => {
    const reglas = await correr('fpgrowth', { minSupport: 0.005, minConfidence: 0.01 });

    expect(reglas.some((r) => r.items.length >= 3)).toBe(true);
  });

  it('cada corrida guarda su algoritmo en parameters (D2) y se lee en /runs/:id', async () => {
    for (const algoritmo of ['apriori', 'fpgrowth'] as const) {
      const [{ runId }] = await correr(algoritmo, { minSupport: 0.05, minConfidence: 0.2 });
      const r = await fetch(`${BASE}/v1/association/runs/${runId}`, { headers: { Authorization: `Bearer ${analista}` } });
      const corrida = (await r.json()) as { parameters: { key: string; value: string }[] };

      expect(corrida.parameters.find((p) => p.key === 'algoritmo')?.value).toBe(algoritmo);
    }
  });

  it('solo el Analista corre FP-Growth: el Administrador recibe 403 y no se crea corrida (Matriz §3, M10)', async () => {
    const admin = await entrar('admin@retail.mx');
    const [{ antes }]: { antes: number }[] = await db.query('SELECT count(*)::int AS antes FROM analisis_corridas');

    const r = await fetch(`${BASE}/v1/association/fpgrowth/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ minSupport: 0.05, minConfidence: 0.1 }),
    });

    expect(r.status).toBe(403);
    const [{ despues }]: { despues: number }[] = await db.query('SELECT count(*)::int AS despues FROM analisis_corridas');
    expect(despues).toBe(antes);
  });

  it('mismos errores de entrada que Apriori: umbral fuera de D-17 o campo no permitido → 400', async () => {
    for (const cuerpo of [
      { minSupport: 0, minConfidence: 0.5 },
      { minSupport: 0.1, minConfidence: 1.01 },
      { minSupport: 0.1, minConfidence: 0.5, algoritmo: 'x' },
    ]) {
      const r = await fetch(`${BASE}/v1/association/fpgrowth/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${analista}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      expect(r.status).toBe(400);
    }
  });
});
