/**
 * Invariantes del historial de precios (RN-06) bajo secuencias ALEATORIAS y CONCURRENTES de altas, contra el servicio
 * real. Después de cada ráfaga se revisa en SQL, para la pareja presentación+tienda:
 *   1. como mucho UN precio abierto (sin fecha de fin),
 *   2. ningún traslape de vigencias,
 *   3. sin huecos: cada precio cerrado termina el día anterior al inicio del siguiente,
 *   4. ningún rango invertido,
 *   5. el "precio actual" por fecha (/prices/current) coincide con el que cubre hoy en SQL.
 * Una semilla fija hace reproducible el caso que falle (se imprime en el mensaje).
 */
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { Client } from 'pg';
import { borrarPresentaciones, crearPresentaciones, PresentacionPropia } from './fixtures';

const BASE = process.env.PRICING_BASE_URL ?? 'http://localhost:3103';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';

const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: parseInt(process.env.REDIS_PORT ?? '6379', 10) });
const db = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  user: process.env.DB_USER ?? 'retail_user',
  password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
  database: process.env.DB_NAME ?? 'retaildb',
});

/** Generador pseudoaleatorio determinista (mulberry32). */
function aleatorio(semilla: number) {
  let a = semilla;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sumarDias = (fecha: string, dias: number) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

describe('historial de precios — invariantes bajo secuencias aleatorias (integración, requiere stack)', () => {
  let token: string;
  let tokenAuditor: string;
  let pares: PresentacionPropia[];

  const alta = async (p: PresentacionPropia, price: number, effectiveDate: string) => {
    const r = await fetch(`${BASE}/v1/prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ presentationId: p.presentacion_id, storeId: p.tienda_id, price, effectiveDate }),
    });
    return r.status;
  };

  async function revisarInvariantes(p: PresentacionPropia, contexto: string) {
    const { rows } = await db.query(
      `SELECT precio::float AS precio, fecha_vigencia_desde::text AS desde, fecha_vigencia_hasta::text AS hasta
       FROM precios WHERE presentacion_id = $1 AND tienda_id = $2 ORDER BY fecha_vigencia_desde`,
      [p.presentacion_id, p.tienda_id],
    );
    const abiertos = rows.filter((r) => r.hasta === null);
    expect({ contexto, abiertos: abiertos.length <= 1 }).toEqual({ contexto, abiertos: true });
    for (let i = 0; i < rows.length; i++) {
      const fila = rows[i];
      if (fila.hasta !== null) expect({ contexto, rangoInvertido: fila.hasta < fila.desde }).toEqual({ contexto, rangoInvertido: false });
      const sig = rows[i + 1];
      if (sig) {
        // sin traslape Y sin hueco: termina justo el día anterior al siguiente
        expect({ contexto, desde: fila.desde, hasta: fila.hasta }).toEqual({ contexto, desde: fila.desde, hasta: sumarDias(sig.desde, -1) });
      } else {
        expect({ contexto, ultimoAbierto: fila.hasta === null }).toEqual({ contexto, ultimoAbierto: true });
      }
    }
    return rows;
  }

  beforeAll(async () => {
    await db.connect();
    const id = (await db.query("SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'Responsable de precios' LIMIT 1")).rows[0].id;
    await redis.set(`session:${id}`, '1', 'EX', 1800);
    token = sign({ sub: id, email: 'p@test', rol: 'Responsable de precios', rolId: 1, jti: 'jti-inv' }, SECRET, { expiresIn: '25m' });
    await redis.set('session:it-inv-aud', '1', 'EX', 1800);
    tokenAuditor = sign({ sub: 'it-inv-aud', email: 'a@test', rol: 'Auditor', rolId: 1, jti: 'jti-inv-aud' }, SECRET, { expiresIn: '25m' });
    pares = await crearPresentaciones(db, 'INV', 6);
  });

  afterAll(async () => {
    for (const p of pares) {
      await redis.incr(`pricing:v:${p.producto_id}`);
      await redis.expire(`pricing:v:${p.producto_id}`, 86400);
    }
    await db.query('DELETE FROM config_alertas_precio');
    await borrarPresentaciones(db, pares);
    await db.end();
    await redis.quit();
  });

  it.each([11, 2026, 424242])('semilla %i: 40 altas secuenciales con fechas aleatorias (pasadas, de hoy y futuras) dejan el historial íntegro', async (semilla) => {
    const azar = aleatorio(semilla);
    const p = pares[[11, 2026, 424242].indexOf(semilla)];
    const estados: Record<number, number> = {};
    for (let i = 0; i < 40; i++) {
      const fecha = sumarDias('2026-06-01', Math.floor(azar() * 120) - 20); // ~140 días de rango, con repetidas
      const estado = await alta(p, Math.round((5 + azar() * 95) * 100) / 100, fecha);
      estados[estado] = (estados[estado] ?? 0) + 1;
      expect([201, 409]).toContain(estado); // 201 aceptado, 409 fecha igual o anterior al historial; nada más
      await revisarInvariantes(p, `semilla ${semilla}, alta ${i + 1}, fecha ${fecha}`);
    }
    expect(estados[201]).toBeGreaterThan(3);
  }, 120000);

  it('ráfagas CONCURRENTES de 8 altas con fechas distintas: el historial queda íntegro y cada alta es 201 o 409', async () => {
    const p = pares[3];
    const azar = aleatorio(7);
    for (let ronda = 0; ronda < 5; ronda++) {
      const fechas = Array.from({ length: 8 }, () => sumarDias('2026-09-01', Math.floor(azar() * 60) - 10));
      const estados = await Promise.all(fechas.map((f, i) => alta(p, 10 + ronda * 10 + i, f)));
      for (const e of estados) expect([201, 409]).toContain(e);
      await revisarInvariantes(p, `ronda ${ronda}, fechas ${fechas.join(',')}`);
    }
  }, 120000);

  it('ráfaga de 8 altas con la MISMA fecha: exactamente una gana', async () => {
    const p = pares[4];
    const estados = await Promise.all(Array.from({ length: 8 }, (_, i) => alta(p, 50 + i, '2026-07-07')));
    expect(estados.filter((e) => e === 201)).toHaveLength(1);
    expect(estados.filter((e) => e === 409)).toHaveLength(7);
    await revisarInvariantes(p, 'misma fecha');
  });

  it('con un precio futuro programado se puede corregir el de hoy, y el futuro sigue intacto (QA-PRI53-03)', async () => {
    const p = pares[5];
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Monterrey' }).format(new Date());
    expect(await alta(p, 100, sumarDias(hoy, -5))).toBe(201);
    expect(await alta(p, 120, sumarDias(hoy, 10))).toBe(201); // futuro programado
    expect(await alta(p, 110, sumarDias(hoy, -1))).toBe(201); // corrige "hoy" aunque el futuro ya exista
    const filas = await revisarInvariantes(p, 'corrección con futuro');
    expect(filas.map((f) => f.precio)).toEqual([100, 110, 120]);
    expect(filas[2].hasta).toBeNull(); // el futuro sigue abierto

    const r = await fetch(`${BASE}/v1/prices/current?presentationId=${p.presentacion_id}`, { headers: { Authorization: `Bearer ${tokenAuditor}` } });
    const actual = (await r.json()) as { data: { price: string }[] };
    expect(actual.data.map((x) => Number(x.price))).toEqual([110]); // el actual por fecha, no el futuro
  });
});
