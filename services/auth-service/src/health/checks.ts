import { getRedis } from '../common/auth/redis.client';

/**
 * Checks de dependencias para `GET /v1/health` (T-02). Cada check devuelve
 * `ok`, `no configurado` (el servicio no usa esa dependencia: NO degrada) o
 * `error: <motivo>`. Nunca lanzan: el health no debe caerse.
 *
 * Los tipos son estructurales a propósito: la plantilla no depende de
 * TypeORM ni de Mongoose; el servicio que los use pasa su `DataSource` o su
 * `Connection` y cumple la forma.
 */
export type Check = () => Promise<string>;

export const NO_CONFIGURADO = 'no configurado';

/** Más que esto y el check cuenta como error: monitoring marca caído a los 3 s (D-44). */
const LIMITE_MS = 2000;

export const sinConfigurar: Check = async () => NO_CONFIGURADO;

export async function verificarRedis(): Promise<string> {
  try {
    await getRedis().ping();
    return 'ok';
  } catch (error) {
    return motivo(error);
  }
}

/** Con TypeORM: `() => verificarPostgres(this.dataSource)`. */
export async function verificarPostgres(fuente: { query(sql: string): Promise<unknown> }): Promise<string> {
  try {
    await fuente.query('SELECT 1');
    return 'ok';
  } catch (error) {
    return motivo(error);
  }
}

/** Con Mongoose: `() => verificarMongo(this.conexion)` (`@InjectConnection()`). */
export async function verificarMongo(conexion: {
  readyState: number;
  db?: { admin(): { ping(): Promise<unknown> } } | null;
}): Promise<string> {
  if (conexion.readyState !== 1 || !conexion.db) return 'error: sin conexión a MongoDB';
  try {
    await conexion.db.admin().ping();
    return 'ok';
  } catch (error) {
    return motivo(error);
  }
}

export interface Salud {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  checks: Record<string, string>;
  /** Lo que tardó cada check, en ms: monitoring-service marca degradado si pasa de 1 s (D-44). */
  latencyMs: Record<string, number>;
  /** Lo que tardó el health completo, en ms. */
  durationMs: number;
  timestamp: string;
}

/**
 * Corre los checks en paralelo, cada uno con tope de 2 s, y arma la
 * respuesta. `degraded` solo si algún check da `error`; `no configurado`
 * no cuenta como falla.
 */
export async function armarSalud(checks: Record<string, Check>): Promise<Salud> {
  const inicio = Date.now();
  const resultados = await Promise.all(
    Object.entries(checks).map(async ([nombre, check]) => {
      const desde = Date.now();
      const estado = await conLimite(check);
      return [nombre, estado, Date.now() - desde] as const;
    }),
  );
  const estados = Object.fromEntries(resultados.map(([nombre, estado]) => [nombre, estado]));
  return {
    status: Object.values(estados).some((e) => e.startsWith('error')) ? 'degraded' : 'ok',
    service: process.env.SERVICE_NAME ?? 'unknown-service',
    version: process.env.SERVICE_VERSION ?? '1.0.0',
    checks: estados,
    latencyMs: Object.fromEntries(resultados.map(([nombre, , ms]) => [nombre, ms])),
    durationMs: Date.now() - inicio,
    timestamp: new Date().toISOString(),
  };
}

async function conLimite(check: Check): Promise<string> {
  let reloj: NodeJS.Timeout | undefined;
  const limite = new Promise<string>((resolver) => {
    reloj = setTimeout(() => resolver(`error: no respondió en ${LIMITE_MS} ms`), LIMITE_MS);
  });
  try {
    return await Promise.race([check().catch(motivo), limite]);
  } finally {
    clearTimeout(reloj);
  }
}

function motivo(error: unknown): string {
  return error instanceof Error ? `error: ${error.message}` : 'error';
}
