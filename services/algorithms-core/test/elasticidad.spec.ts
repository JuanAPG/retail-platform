/**
 * Integración de elasticidad: calculate → chart → current con números
 * verificados. La referencia se calcula aquí mismo, aparte del servicio:
 * líneas de venta crudas → zona × día local → regresión de ln q contra ln p.
 * Así sirve con cualquier carga de ventas (p. ej. db/datos_prueba_100_canastas.csv).
 *
 * Crea corridas y las borra al terminar, aunque la prueba falle.
 *
 *   docker compose -f infra/docker-compose.yml up -d postgres redis auth-service algorithms-core
 *   npm run test:integracion
 */
import { DataSource } from 'typeorm';
import databaseConfig from '../src/config/database.config';
import { ZONA_HORARIA } from '../src/config/zona-horaria';

const BASE = process.env.ALGORITHMS_BASE_URL ?? 'http://localhost:3105';
const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';
const TOLERANCIA = 1e-4;

interface Resultado {
  presentationId: string;
  zoneId: string | null;
  value: number;
  rSquared: number | null;
  observations: number;
}
interface Calculo {
  runId: string;
  periodStart: string;
  periodEnd: string;
  results: Resultado[];
}
interface Vigente extends Resultado {
  runId: string;
  outdated: boolean;
  periodStart: string;
  periodEnd: string;
}
interface Barra {
  key: string;
  value: number | null;
  observations: number;
}

/** Regresión simple, escrita aparte de elasticity.math, con los mismos mínimos. */
function referencia(puntos: { precio: number; cantidad: number }[]): { e: number; r2: number | null; n: number } | null {
  const n = puntos.length;
  const precios = new Set(puntos.map((p) => Math.round(p.precio * 1e4) / 1e4));
  if (n < 3 || precios.size < 2) return null;
  const xs = puntos.map((p) => Math.log(p.precio));
  const ys = puntos.map((p) => Math.log(p.cantidad));
  const mx = xs.reduce((a, b) => a + b) / n;
  const my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return { e: syy < 1e-12 ? 0 : sxy / sxx, r2: syy < 1e-12 ? null : (sxy * sxy) / (sxx * syy), n };
}

describe('Elasticidad (integración, requiere stack y ventas cargadas)', () => {
  // Mismas credenciales que el servicio; sin entidades: solo SQL de lectura y la limpieza.
  const opciones = databaseConfig() as { host: string; port: number; username: string; password: string; database: string };
  const db = new DataSource({
    type: 'postgres',
    host: opciones.host,
    port: opciones.port,
    username: opciones.username,
    password: opciones.password,
    database: opciones.database,
  });
  const creadas: string[] = [];
  let token = '';

  async function http<T>(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<{ status: number; json: T }> {
    const r = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    return { status: r.status, json: (await r.json()) as T };
  }

  async function calcular(cuerpo: object): Promise<Calculo> {
    const { status, json } = await http<Calculo & { message?: string }>('POST', '/v1/elasticity/calculate', cuerpo);
    if (status !== 201) {
      throw new Error(`calculate respondió ${status}: ${json.message} (¿hay ventas? cargar db/datos_prueba_100_canastas.csv)`);
    }
    creadas.push(json.runId);
    return json;
  }

  const vigentes = async (filtro = '') =>
    (await http<{ data: Vigente[] }>('GET', `/v1/elasticity/current?limit=100${filtro}`)).json.data;

  beforeAll(async () => {
    await db.initialize();
    const login = await fetch(`${AUTH}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Solo el Responsable de precios calcula (Matriz §3, M11).
        email: process.env.ELASTICIDAD_TEST_EMAIL ?? 'precios@retail.mx',
        password: process.env.ALGORITHMS_TEST_PASSWORD ?? 'Passw0rd123!',
      }),
    });
    token = ((await login.json()) as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    if (creadas.length > 0) await db.query('DELETE FROM analisis_corridas WHERE id = ANY($1::uuid[])', [creadas]);
    await db.destroy();
  });

  it('calculate coincide con la referencia; chart y current muestran lo mismo; una corrida posterior marca outdated', async () => {
    // Referencia: zona × día en la zona del negocio, precio ponderado por unidades.
    const rows: { p: string; z: string; cantidad: number; ingreso: number }[] = await db.query(
      `SELECT d.presentacion_id AS p, k.zona_id AS z,
              SUM(d.cantidad)::float8 AS cantidad, SUM(d.cantidad * d.precio_unitario)::float8 AS ingreso
       FROM transacciones_detalle d JOIN canastas k ON k.transaccion_id = d.transaccion_id
       GROUP BY 1, 2, to_char(k.fecha AT TIME ZONE $1, 'YYYY-MM-DD')`,
      [ZONA_HORARIA],
    );
    const puntos = rows.map((r) => ({ ...r, precio: r.ingreso / r.cantidad }));
    const esperado = (p: string, z: string | null) =>
      referencia(puntos.filter((x) => x.p === p && (z === null || x.z === z)));

    // 1. calculate: cada resultado coincide, y no falta ninguno que la referencia sí calcule.
    const calculo = await calcular({});
    for (const r of calculo.results) {
      const ref = esperado(r.presentationId, r.zoneId);
      expect(ref).not.toBeNull();
      expect(Math.abs(r.value - ref!.e)).toBeLessThan(TOLERANCIA);
      expect(r.observations).toBe(ref!.n);
      if (ref!.r2 === null) expect(r.rSquared).toBeNull();
      else expect(Math.abs(r.rSquared! - ref!.r2)).toBeLessThan(TOLERANCIA);
    }
    const combinaciones = [...new Set(puntos.map((x) => x.p))].flatMap((p) => [
      [p, null] as const,
      ...[...new Set(puntos.filter((x) => x.p === p).map((x) => x.z))].map((z) => [p, z] as const),
    ]);
    const calculables = combinaciones.filter(([p, z]) => esperado(p, z) !== null);
    expect(calculo.results.length).toBe(calculables.length);

    // La presentación con más resultados (con el CSV de 100 canastas: el frijol).
    const porPresentacion = new Map<string, Resultado[]>();
    for (const r of calculo.results) porPresentacion.set(r.presentationId, [...(porPresentacion.get(r.presentationId) ?? []), r]);
    const [presentacion, suyos] = [...porPresentacion.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const deZona = (z: string | null) => suyos.find((r) => r.zoneId === z);

    // 2. chart con esa corrida: las barras y el nacional son los de calculate.
    const { status, json: grafico } = await http<{ bars: Barra[]; national: { value: number } | null }>(
      'GET',
      `/v1/elasticity/chart?presentationId=${presentacion}&runId=${calculo.runId}`,
    );
    expect(status).toBe(200);
    for (const barra of grafico.bars) {
      const r = deZona(barra.key);
      expect(barra.value).toBe(r ? r.value : null);
      expect(barra.observations).toBe(r ? r.observations : 0);
    }
    expect(grafico.national?.value ?? null).toBe(deZona(null)?.value ?? null);

    // 3. current: lo de esta corrida, con su periodo y sin outdated. Una fila
    // de una corrida anterior solo puede quedar si esta no la pudo recalcular.
    const actuales = await vigentes(`&presentationId=${presentacion}`);
    for (const r of suyos) {
      const fila = actuales.find((f) => f.zoneId === r.zoneId)!;
      expect(fila).toMatchObject({
        runId: calculo.runId,
        value: r.value,
        outdated: false,
        periodStart: calculo.periodStart,
        periodEnd: calculo.periodEnd,
      });
    }
    for (const fila of actuales.filter((f) => f.runId !== calculo.runId)) expect(fila.outdated).toBe(true);

    // 4. Corrida posterior SOLO de esa presentación y solo su primer día: no
    // alcanza a recalcular. Cada fila queda con la corrida nueva o outdated;
    // las demás presentaciones no cambian.
    const otrasAntes = (await vigentes()).filter((f) => f.presentationId !== presentacion);
    const [{ primero }]: { primero: string }[] = await db.query(
      `SELECT to_char(MIN(k.fecha AT TIME ZONE $2), 'YYYY-MM-DD') AS primero
       FROM transacciones_detalle d JOIN canastas k ON k.transaccion_id = d.transaccion_id
       WHERE d.presentacion_id = $1`,
      [presentacion, ZONA_HORARIA],
    );
    const posterior = await calcular({ presentationId: presentacion, dateTo: primero });
    for (const fila of await vigentes(`&presentationId=${presentacion}`)) {
      if (fila.runId === posterior.runId) expect(fila.outdated).toBe(false);
      else expect(fila.outdated).toBe(true);
    }
    const otrasDespues = (await vigentes()).filter((f) => f.presentationId !== presentacion);
    expect(otrasDespues.map((f) => [f.presentationId, f.zoneId, f.runId, f.outdated])).toEqual(
      otrasAntes.map((f) => [f.presentationId, f.zoneId, f.runId, f.outdated]),
    );
  });
});
