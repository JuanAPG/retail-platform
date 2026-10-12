/**
 * Integración de Apriori (ALG-06): dos corridas idénticas devuelven las
 * reglas en el MISMO orden, incluidas las empatadas. Se compara la
 * respuesta tal como llega, sin ordenarla.
 *
 * Para que la prueba no pase sin probar nada, busca en las ventas cargadas
 * un rango de fechas donde dos productos aparezcan en el mismo número de
 * canastas (A→B y B→A empatan en confianza, lift y soporte). Corta los días
 * en UTC y en America/Monterrey y exige el empate en los dos, así no
 * depende de en qué zona corte el servicio. Borra las corridas que crea.
 *
 *   docker compose -f infra/docker-compose.yml up -d postgres redis auth-service algorithms-core
 *   npm run test:integracion
 */
import { DataSource } from 'typeorm';
import { compararReglas, ReglaConProductos } from '../src/association/association.service';
import databaseConfig from '../src/config/database.config';

const BASE = process.env.ALGORITHMS_BASE_URL ?? 'http://localhost:3105';
const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';

interface Linea {
  canasta: string;
  producto: string;
  diaUtc: string;
  diaLocal: string;
}

/** ¿Hay en [desde, hasta] dos productos con las mismas canastas y al menos una juntos? */
function hayEmpate(lineas: Linea[], dia: (l: Linea) => string, desde: string, hasta: string): boolean {
  const canastas = new Map<string, Set<string>>();
  for (const l of lineas) {
    if (dia(l) < desde || dia(l) > hasta) continue;
    canastas.set(l.canasta, (canastas.get(l.canasta) ?? new Set()).add(l.producto));
  }
  const cuenta = new Map<string, number>();
  const juntos = new Set<string>();
  for (const productos of canastas.values()) {
    for (const p of productos) cuenta.set(p, (cuenta.get(p) ?? 0) + 1);
    for (const a of productos) for (const b of productos) if (a < b) juntos.add(`${a}|${b}`);
  }
  return [...juntos].some((par) => {
    const [a, b] = par.split('|');
    return cuenta.get(a) === cuenta.get(b);
  });
}

describe('Apriori (integración, requiere stack y ventas cargadas)', () => {
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
  let token = '';

  async function correr(cuerpo: object): Promise<ReglaConProductos[]> {
    const r = await fetch(`${BASE}/v1/association/apriori/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const json = (await r.json()) as ReglaConProductos[] & { message?: string };
    if (r.status !== 201) throw new Error(`apriori/run respondió ${r.status}: ${json.message}`);
    for (const regla of json) creadas.add(regla.runId);
    return json;
  }

  beforeAll(async () => {
    await db.initialize();
    const login = await fetch(`${AUTH}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.ALGORITHMS_TEST_EMAIL ?? 'analista@retail.mx',
        password: process.env.ALGORITHMS_TEST_PASSWORD ?? 'Passw0rd123!',
      }),
    });
    token = ((await login.json()) as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    if (creadas.size > 0) await db.query('DELETE FROM analisis_corridas WHERE id = ANY($1::uuid[])', [[...creadas]]);
    await db.destroy();
  });

  it('corridas idénticas devuelven las reglas empatadas en el mismo orden', async () => {
    const lineas: Linea[] = await db.query(
      `SELECT DISTINCT k.id AS canasta, pp.producto_id AS producto,
              to_char(k.fecha AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "diaUtc",
              to_char(k.fecha AT TIME ZONE 'America/Monterrey', 'YYYY-MM-DD') AS "diaLocal"
       FROM canastas k
       JOIN transacciones_detalle d ON d.transaccion_id = k.transaccion_id
       JOIN producto_presentaciones pp ON pp.id = d.presentacion_id`,
    );
    const dias = [...new Set(lineas.flatMap((l) => [l.diaUtc, l.diaLocal]))].sort();
    // El rango más amplio con empate en los dos cortes.
    let rango: [string, string] | null = null;
    for (let largo = dias.length - 1; largo >= 0 && !rango; largo--) {
      for (let i = 0; i + largo < dias.length && !rango; i++) {
        const [desde, hasta] = [dias[i], dias[i + largo]];
        if (hayEmpate(lineas, (l) => l.diaUtc, desde, hasta) && hayEmpate(lineas, (l) => l.diaLocal, desde, hasta)) {
          rango = [desde, hasta];
        }
      }
    }
    if (!rango) throw new Error('Las ventas cargadas no tienen reglas empatadas: no se puede probar ALG-06 (cargar db/datos_prueba_100_canastas.csv).');

    // Con desempate aleatorio, cada corrida acierta el orden por azar con
    // probabilidad 1/2 por empate: con 5, el error pasaría a lo más 1 de 32 veces.
    const cuerpo = { minSupport: 0.01, minConfidence: 0.01, dateFrom: rango[0], dateTo: rango[1] };
    const corridas: ReglaConProductos[][] = [];
    for (let i = 0; i < 5; i++) corridas.push(await correr(cuerpo));
    const [primera] = corridas;

    // La respuesta trae al menos un empate: si no, la prueba no probaría nada.
    const metricas = primera.map((r) => `${r.confidence}|${r.lift}|${r.support}`);
    expect(new Set(metricas).size).toBeLessThan(metricas.length);

    const firma = (reglas: ReglaConProductos[]) =>
      reglas.map((r) => r.items.map((i) => `${i.side}:${i.productId}`).join(','));
    // Y es el orden definido, no uno que casualmente se repitió.
    const definido = firma([...primera].sort(compararReglas));
    for (const corrida of corridas) expect(firma(corrida)).toEqual(definido);
  });

  it('solo el Analista corre Apriori: el Administrador recibe 403 y no se crea corrida (Matriz §3, M10)', async () => {
    const login = await fetch(`${AUTH}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@retail.mx', password: process.env.ALGORITHMS_TEST_PASSWORD ?? 'Passw0rd123!' }),
    });
    const admin = ((await login.json()) as { accessToken: string }).accessToken;
    const [{ antes }]: { antes: number }[] = await db.query('SELECT count(*)::int AS antes FROM analisis_corridas');

    const r = await fetch(`${BASE}/v1/association/apriori/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ minSupport: 0.05, minConfidence: 0.1 }),
    });

    expect(r.status).toBe(403);
    const [{ despues }]: { despues: number }[] = await db.query('SELECT count(*)::int AS despues FROM analisis_corridas');
    expect(despues).toBe(antes);
  });
});
