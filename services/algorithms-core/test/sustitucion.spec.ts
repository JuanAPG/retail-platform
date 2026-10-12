/**
 * Integración de sustitución (ALG-03): GET /v1/substitution/patterns contra
 * una referencia calculada aparte desde las canastas crudas (lift,
 * observaciones, periodo y qué pares deben aparecer). Solo lee: no crea nada.
 *
 *   docker compose -f infra/docker-compose.yml up -d postgres redis auth-service algorithms-core
 *   npm run test:integracion
 */
import { DataSource } from 'typeorm';
import databaseConfig from '../src/config/database.config';

const BASE = process.env.ALGORITHMS_BASE_URL ?? 'http://localhost:3105';
const AUTH = process.env.AUTH_BASE_URL ?? 'http://localhost:3101';

interface Patron {
  originProductId: string;
  targetProductId: string;
  type: 'precio' | 'preferencia';
  score: number;
  lift: number;
  priceCorrelation: number | null;
  observations: number;
  priceVariation: number | null;
  summary: string;
  periodStart: string;
  periodEnd: string;
}

describe('Sustitución (integración, requiere stack y ventas cargadas)', () => {
  const opciones = databaseConfig() as { host: string; port: number; username: string; password: string; database: string };
  const db = new DataSource({
    type: 'postgres',
    host: opciones.host,
    port: opciones.port,
    username: opciones.username,
    password: opciones.password,
    database: opciones.database,
  });
  let token = '';

  const patrones = async (query: string) => {
    const r = await fetch(`${BASE}/v1/substitution/patterns${query}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, json: (await r.json()) as Patron[] };
  };

  beforeAll(async () => {
    await db.initialize();
    const login = await fetch(`${AUTH}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Es lectura: cualquier perfil interno sirve.
      body: JSON.stringify({ email: 'planeador@retail.mx', password: process.env.ALGORITHMS_TEST_PASSWORD ?? 'Passw0rd123!' }),
    });
    token = ((await login.json()) as { accessToken: string }).accessToken;
  });

  afterAll(() => db.destroy());

  it('cada categoría coincide con la referencia: lift, observaciones, periodo y pares completos', async () => {
    const categorias: { id: number }[] = await db.query(
      'SELECT categoria_id AS id FROM productos GROUP BY 1 HAVING count(*) >= 2 ORDER BY 1',
    );
    let conPatrones = 0;
    for (const { id } of categorias) {
      // Referencia: canastas que llevaron algo de la categoría, con sus productos de la categoría.
      const filas: { canasta: string; producto: string; dia: string }[] = await db.query(
        `SELECT DISTINCT k.id AS canasta, pp.producto_id AS producto, to_char(k.fecha AT TIME ZONE 'America/Monterrey', 'YYYY-MM-DD') AS dia
         FROM canastas k
         JOIN transacciones_detalle d ON d.transaccion_id = k.transaccion_id
         JOIN producto_presentaciones pp ON pp.id = d.presentacion_id
         JOIN productos p ON p.id = pp.producto_id
         WHERE p.categoria_id = $1`,
        [id],
      );
      const canastas = new Map<string, Set<string>>();
      for (const f of filas) canastas.set(f.canasta, (canastas.get(f.canasta) ?? new Set()).add(f.producto));
      const total = canastas.size;
      const cuenta = (p: string) => [...canastas.values()].filter((s) => s.has(p)).length;
      const juntos = (a: string, b: string) => [...canastas.values()].filter((s) => s.has(a) && s.has(b)).length;
      const dias = filas.map((f) => f.dia).sort();

      // limit=100 (el máximo): para comparar contra la referencia hacen falta todos los pares.
      const { status, json } = await patrones(`?categoryId=${id}&limit=100`);
      expect(status).toBe(200);
      if (json.length > 0) conPatrones++;
      const enCategoria = new Set(filas.map((f) => f.producto));

      for (const p of json) {
        expect(enCategoria.has(p.originProductId) && enCategoria.has(p.targetProductId)).toBe(true);
        const [a, b] = [cuenta(p.originProductId), cuenta(p.targetProductId)];
        const lift = (juntos(p.originProductId, p.targetProductId) * total) / (a * b);
        expect(Math.abs(p.lift - lift)).toBeLessThan(1e-4);
        expect(p.lift).toBeLessThan(1);
        expect(p.observations).toBe(total);
        expect([p.periodStart, p.periodEnd]).toEqual([dias[0], dias[dias.length - 1]]);
        expect(p.score).toBeGreaterThanOrEqual(0);
        expect(p.score).toBeLessThanOrEqual(1);
        if (p.type === 'precio') expect(p.priceCorrelation!).toBeGreaterThanOrEqual(0.3);
        expect(p.summary).toMatch(/^Indicio de sustitución/);
      }

      // Completo: todo par elegible con lift < 1 aparece (en algún sentido).
      const productos = [...enCategoria].filter((p) => cuenta(p) >= 2);
      for (let i = 0; i < productos.length; i++) {
        for (let j = i + 1; j < productos.length; j++) {
          const [x, y] = [productos[i], productos[j]];
          const esperadoJuntos = (cuenta(x) * cuenta(y)) / total;
          const lift = (juntos(x, y) * total) / (cuenta(x) * cuenta(y));
          const aparece = json.some((p) => [p.originProductId, p.targetProductId].sort().join() === [x, y].sort().join());
          expect(aparece).toBe(esperadoJuntos >= 1 && lift < 1);
        }
      }
    }
    // Con el CSV de 100 canastas, Abarrotes da Frijol → Quinoa: la prueba no pasa en vacío.
    expect(conPatrones).toBeGreaterThan(0);
  });

  it('categoría inexistente → 404; categoryId o limit ausente o no entero positivo → 400', async () => {
    expect((await patrones('?categoryId=999999')).status).toBe(404);
    for (const q of ['', '?categoryId=abc', '?categoryId=0', '?categoryId=1.5', '?categoryId=1&limit=0', '?categoryId=1&limit=abc']) {
      expect((await patrones(q)).status).toBe(400);
    }
  });
});
