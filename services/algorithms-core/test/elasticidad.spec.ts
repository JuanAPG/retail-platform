/**
 * Integración de elasticidad: calculate → chart → current con números
 * verificados. La referencia se calcula aquí mismo, aparte del servicio:
 * líneas de venta crudas → zona × día local → regresión de ln q contra ln p.
 * Así sirve con cualquier carga de ventas (p. ej. db/datos_prueba_100_canastas.csv).
 *
 * La referencia aplica las mismas reglas que el servicio, incluido el tope
 * de la columna (QA-ALG56-16), y corta los días en America/Monterrey ESCRITA
 * AQUÍ, no leída de `ZONA_HORARIA`: si el servicio corre con otra zona, la
 * prueba falla en vez de equivocarse igual que él (QA-ALG56-10).
 *
 * Crea corridas y las borra al terminar, aunque la prueba falle.
 *
 *   docker compose -f infra/docker-compose.yml up -d postgres redis auth-service algorithms-core
 *   npm run test:integracion
 */
import { DataSource } from 'typeorm';
import databaseConfig from '../src/config/database.config';

const BASE = process.env.ALGORITHMS_BASE_URL ?? 'http://localhost:3105';
const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';
const TOLERANCIA = 1e-4;
/** Día de negocio (regla, no configuración): el servicio debe cortar igual. */
const DIA_DE_NEGOCIO = 'America/Monterrey';
/** `elasticidades.valor` es numeric(10,4): lo que no cabe va a `insufficient`. */
const MAXIMO_GUARDABLE = 999_999.9999;

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

/**
 * Regresión simple, escrita aparte de elasticity.math, con los mismos
 * mínimos y el mismo tope. `null` = el servicio debe mandarla a `insufficient`.
 */
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
  const e = syy < 1e-12 ? 0 : sxy / sxx;
  if (Math.abs(Math.round(e * 1e4) / 1e4) > MAXIMO_GUARDABLE) return null;
  return { e, r2: syy < 1e-12 ? null : (sxy * sxy) / (sxx * syy), n };
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

  /**
   * Observaciones zona × periodo cortando los días en `zona`. `periodo`
   * es 'day' (default), 'week' o 'month' (D-21): mismo `date_trunc` que
   * `PERIODO_SQL` de FuenteDatos.
   */
  async function observaciones(zona: string, periodo: 'day' | 'week' | 'month' = 'day') {
    // Primero se pasa fecha a la hora local de `zona` (timestamp sin tz) y
    // SOBRE ESO se trunca: así no importa qué zona tenga la sesión de la
    // conexión de la prueba, igual que hace el servicio con la suya.
    const corte =
      periodo === 'day' ? '(k.fecha AT TIME ZONE $1)' : `date_trunc('${periodo}', k.fecha AT TIME ZONE $1)`;
    const rows: { p: string; z: string; cantidad: number; ingreso: number }[] = await db.query(
      `SELECT d.presentacion_id AS p, k.zona_id AS z,
              SUM(d.cantidad)::float8 AS cantidad, SUM(d.cantidad * d.precio_unitario)::float8 AS ingreso
       FROM transacciones_detalle d JOIN canastas k ON k.transaccion_id = d.transaccion_id
       GROUP BY 1, 2, to_char(${corte}, 'YYYY-MM-DD')`,
      [zona],
    );
    const puntos = rows.map((r) => ({ ...r, precio: r.ingreso / r.cantidad }));
    return (p: string, z: string | null) => referencia(puntos.filter((x) => x.p === p && (z === null || x.z === z)));
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
    // Referencia: zona × día de negocio, precio ponderado por unidades.
    // granularity explícito: el default cambió a 'week' (D-21) y la prueba
    // de zona horaria que sigue necesita el corte más fino, por día.
    const esperado = await observaciones(DIA_DE_NEGOCIO, 'day');
    const conDiaUtc = await observaciones('UTC', 'day');

    // 1. calculate: cada resultado coincide, y no falta ninguno que la referencia sí calcule.
    const calculo = await calcular({ granularity: 'day' });
    // Para que la zona horaria quede probada, algún resultado debe cambiar si
    // los días se cortaran en UTC (hace falta alguna venta entre las 18:00 y
    // las 24:00 locales). Si no, la prueba no distinguiría las dos zonas.
    const distingueZona = calculo.results.some((r) => {
      const [local, utc] = [esperado(r.presentationId, r.zoneId), conDiaUtc(r.presentationId, r.zoneId)];
      return !utc || local!.n !== utc.n || Math.abs(local!.e - utc.e) >= TOLERANCIA;
    });
    if (!distingueZona) {
      throw new Error('Ningún resultado cambia entre el día UTC y el de Monterrey: hacen falta ventas nocturnas (18:00–24:00 locales) para probar la zona horaria.');
    }
    for (const r of calculo.results) {
      const ref = esperado(r.presentationId, r.zoneId);
      expect(ref).not.toBeNull();
      expect(Math.abs(r.value - ref!.e)).toBeLessThan(TOLERANCIA);
      expect(r.observations).toBe(ref!.n);
      if (ref!.r2 === null) expect(r.rSquared).toBeNull();
      else expect(Math.abs(r.rSquared! - ref!.r2)).toBeLessThan(TOLERANCIA);
    }
    const lineas: { p: string; z: string }[] = await db.query(
      `SELECT DISTINCT d.presentacion_id AS p, k.zona_id AS z
       FROM transacciones_detalle d JOIN canastas k ON k.transaccion_id = d.transaccion_id`,
    );
    const combinaciones = [...new Set(lineas.map((x) => x.p))].flatMap((p) => [
      [p, null] as const,
      ...lineas.filter((x) => x.p === p).map((x) => [p, x.z] as const),
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

    // 4. D-22: una corrida con dateTo nunca se vuelve vigente ni marca nada
    // outdated, aunque sea posterior y de la MISMA presentación — es
    // exploratoria, se consulta por su runId en /chart. `dateTo` se fija al
    // propio `periodEnd` de la corrida de arriba: abarca EXACTAMENTE los
    // mismos datos (mismos resultados garantizados, para que /chart no
    // 404 por falta de elasticidades), y lo único que cambia es que el
    // parámetro queda presente — que es justo lo que D-22 mira, no si la
    // ventana de verdad recorta algo. Las demás presentaciones no cambian.
    const antesDeExploratoria = await vigentes(`&presentationId=${presentacion}`);
    const otrasAntes = (await vigentes()).filter((f) => f.presentationId !== presentacion);
    const exploratoria = await calcular({ presentationId: presentacion, dateTo: calculo.periodEnd });

    const despuesDeExploratoria = await vigentes(`&presentationId=${presentacion}`);
    // Ni una fila cambia de runId, valor ni outdated: /current ignora
    // por completo la corrida con dateTo, sin importar que sea más nueva.
    expect(despuesDeExploratoria).toEqual(antesDeExploratoria);
    expect(despuesDeExploratoria.map((f) => f.runId)).not.toContain(exploratoria.runId);

    const otrasDespues = (await vigentes()).filter((f) => f.presentationId !== presentacion);
    expect(otrasDespues.map((f) => [f.presentationId, f.zoneId, f.runId, f.outdated])).toEqual(
      otrasAntes.map((f) => [f.presentationId, f.zoneId, f.runId, f.outdated]),
    );

    // La corrida exploratoria SIGUE pudiéndose consultar por su runId:
    // D-22 la saca de /current, no la esconde de /chart.
    const { status: statusExploratoria } = await http(
      'GET',
      `/v1/elasticity/chart?presentationId=${presentacion}&runId=${exploratoria.runId}`,
    );
    expect(statusExploratoria).toBe(200);
  });

  it('granularity=month agrupa las ventas por mes (D-21) y coincide con una referencia agrupada igual', async () => {
    const esperadoPorMes = await observaciones(DIA_DE_NEGOCIO, 'month');

    const calculo = await calcular({ granularity: 'month' });

    expect(calculo.results.length).toBeGreaterThan(0);
    for (const r of calculo.results) {
      const ref = esperadoPorMes(r.presentationId, r.zoneId);
      expect(ref).not.toBeNull();
      expect(Math.abs(r.value - ref!.e)).toBeLessThan(TOLERANCIA);
      expect(r.observations).toBe(ref!.n);
    }
  });

  it('sin granularity, el default es semana: coincide con la referencia agrupada por semana ISO', async () => {
    const esperadoPorSemana = await observaciones(DIA_DE_NEGOCIO, 'week');

    const calculo = await calcular({});

    for (const r of calculo.results) {
      const ref = esperadoPorSemana(r.presentationId, r.zoneId);
      expect(ref).not.toBeNull();
      expect(Math.abs(r.value - ref!.e)).toBeLessThan(TOLERANCIA);
      expect(r.observations).toBe(ref!.n);
    }
  });

  it('solo el Responsable de precios calcula: el Analista recibe 403 y no se crea corrida (Matriz §3, M11)', async () => {
    const login = await fetch(`${AUTH}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'analista@retail.mx', password: process.env.ALGORITHMS_TEST_PASSWORD ?? 'Passw0rd123!' }),
    });
    const analista = ((await login.json()) as { accessToken: string }).accessToken;
    const [{ antes }]: { antes: number }[] = await db.query('SELECT count(*)::int AS antes FROM analisis_corridas');

    const r = await fetch(`${BASE}/v1/elasticity/calculate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${analista}`, 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(r.status).toBe(403);
    const [{ despues }]: { despues: number }[] = await db.query('SELECT count(*)::int AS despues FROM analisis_corridas');
    expect(despues).toBe(antes);
  });
});
