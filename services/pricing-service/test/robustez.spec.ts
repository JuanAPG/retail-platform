/**
 * Robustez de pricing-service ante entradas hostiles, contra el servicio real (Postgres + Redis + audit + notifications).
 *
 *   docker compose up -d postgres redis pricing-service audit-service notifications-service
 *   npm run test:integracion
 *
 * Regla única que se exige a CADA petición: jamás 5xx, y todo error trae el cuerpo estándar
 * { statusCode, message, code }. Para cada endpoint que recibe cuerpo se toma un cuerpo VÁLIDO y se corrompe un campo
 * a la vez con una batería de valores peligrosos (nulos, tipos equivocados, desbordes numéricos, texto enorme, byte
 * nulo, inyección SQL, fechas imposibles...). Además se prueban queries mal formadas, JSON roto, content-types
 * ajenos, métodos no soportados y credenciales inválidas.
 */
import Redis from 'ioredis';
import { sign } from 'jsonwebtoken';
import { Client } from 'pg';
import { borrarPresentaciones, crearPresentaciones, PresentacionPropia } from './fixtures';

const BASE = process.env.PRICING_BASE_URL ?? 'http://localhost:3103';
const SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_solo_para_local';
const EMAIL_PROVEEDOR = 'ventas@lacteosdelnorte.mx';
const UUID_FALSO = '00000000-0000-4000-8000-000000000000';

const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: parseInt(process.env.REDIS_PORT ?? '6379', 10) });
const db = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  user: process.env.DB_USER ?? 'retail_user',
  password: process.env.DB_PASSWORD ?? 'retail_pass_2026',
  database: process.env.DB_NAME ?? 'retaildb',
});

async function sesion(userId: string, rol: string, email = `${userId}@test`): Promise<string> {
  await redis.set(`session:${userId}`, '1', 'EX', 1200);
  return sign({ sub: userId, email, rol, rolId: 1, jti: `jti-${userId}` }, SECRET, { expiresIn: '20m' });
}

interface Respuesta {
  estado: number;
  texto: string;
  json: any;
}

async function pedir(
  metodo: string,
  ruta: string,
  opciones: { token?: string; cuerpo?: unknown; crudo?: string; tipo?: string; accept?: string; cabeceras?: Record<string, string> } = {},
): Promise<Respuesta> {
  const cuerpo = opciones.crudo ?? (opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo));
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo !== undefined ? { 'Content-Type': opciones.tipo ?? 'application/json' } : {}),
      ...(opciones.token ? { Authorization: `Bearer ${opciones.token}` } : {}),
      ...(opciones.accept ? { Accept: opciones.accept } : {}),
      ...opciones.cabeceras,
    },
    body: cuerpo,
  });
  const texto = await r.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* no era JSON (p. ej. XML) */
  }
  return { estado: r.status, texto, json };
}

/** La regla de oro: ni un 5xx, y todo error con el cuerpo estándar. */
function exigirSano(r: Respuesta, contexto: string) {
  if (r.estado >= 500) throw new Error(`${contexto} → HTTP ${r.estado}: ${r.texto.slice(0, 300)}`);
  if (r.estado >= 400 && r.json) {
    if (typeof r.json.statusCode !== 'number' || typeof r.json.message === 'undefined' || typeof r.json.code !== 'string') {
      throw new Error(`${contexto} → HTTP ${r.estado} sin el cuerpo de error estándar: ${r.texto.slice(0, 300)}`);
    }
  }
}

/** Valores que corrompen un campo. `undefined` significa "quitar el campo". */
const MALOS: Array<[string, unknown]> = [
  ['ausente', undefined],
  ['null', null],
  ['vacío', ''],
  ['espacios', '   '],
  ['texto', 'abc'],
  ['cero', 0],
  ['negativo', -1],
  ['decimal negativo', -0.001],
  ['3 decimales', 12.345],
  ['desborda numeric(12,2)', 99999999999999],
  ['1e15', 1e15],
  ['1e308', 1e308],
  ['entero enorme', 123456789012345678901234567890],
  ['notación científica', '1e5'],
  ['booleano', true],
  ['arreglo vacío', []],
  ['arreglo de nulos', [null]],
  ['objeto', {}],
  ['objeto anidado', { a: { b: 1 } }],
  ['texto enorme', 'x'.repeat(200_000)],
  ['byte nulo', 'a\u0000b'],
  ['emoji', '😀😀😀'],
  ['inyección SQL', "'; DROP TABLE precios; --"],
  ['inyección en JSON', '{"$ne":null}'],
  ['uuid mal formado', '123e4567-e89b-12d3-a456-42661417400'],
  ['fecha imposible', '2026-02-30'],
  ['fecha mes 13', '2026-13-45'],
  ['fecha año 0', '0000-00-00'],
  ['fecha lejana', '9999-12-31'],
  ['fecha con hora inválida', '2026-10-09T25:61:00Z'],
  ['prototype', { __proto__: { admin: true } }],
];

describe('pricing-service — robustez ante entradas hostiles (integración, requiere stack)', () => {
  let precios: string;
  let analista: string;
  let proveedor: string;
  let auditor: string;
  let propias: PresentacionPropia[];
  let presentationId: string;
  let storeId: string;
  let productId: string;

  const usuarioReal = async (rol: string): Promise<string> =>
    (await db.query('SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = $1 LIMIT 1', [rol])).rows[0].id;

  beforeAll(async () => {
    await db.connect();
    precios = await sesion(await usuarioReal('Responsable de precios'), 'Responsable de precios');
    analista = await sesion(await usuarioReal('Analista comercial'), 'Analista comercial');
    auditor = await sesion('it-rb-auditor', 'Auditor');
    const idProv = (await db.query('SELECT id FROM usuarios WHERE email = $1', [EMAIL_PROVEEDOR])).rows[0].id;
    proveedor = await sesion(idProv, 'Proveedor', EMAIL_PROVEEDOR);
    propias = await crearPresentaciones(db, 'RB', 1, { emailProveedor: EMAIL_PROVEEDOR });
    ({ presentacion_id: presentationId, tienda_id: storeId, producto_id: productId } = propias[0]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM config_alertas_precio');
    await redis.incr(`pricing:v:${productId}`);
    await redis.expire(`pricing:v:${productId}`, 86400);
    await borrarPresentaciones(db, propias);
    await db.end();
    await redis.quit();
  });

  // --------------------------------------------------------------------------------------------------------------
  // 1. Cada campo de cada cuerpo, corrompido de uno en uno
  // --------------------------------------------------------------------------------------------------------------
  const cuerpos = (): Array<{ nombre: string; metodo: string; ruta: () => string; token: () => string; valido: () => Record<string, unknown> }> => [
    {
      nombre: 'POST /v1/prices',
      metodo: 'POST',
      ruta: () => '/v1/prices',
      token: () => precios,
      valido: () => ({ presentationId, storeId, price: 10.5, effectiveDate: '2026-01-15' }),
    },
    {
      nombre: 'POST /v1/price-proposals',
      metodo: 'POST',
      ruta: () => '/v1/price-proposals',
      token: () => proveedor,
      valido: () => ({ presentationId, proposedPrice: 12.5, purchaseUnit: 'caja' }),
    },
    {
      nombre: 'PATCH /v1/price-proposals/:id/approve',
      metodo: 'PATCH',
      ruta: () => `/v1/price-proposals/${UUID_FALSO}/approve`,
      token: () => precios,
      valido: () => ({ storeIds: [storeId], effectiveDate: '2026-02-01' }),
    },
    {
      nombre: 'PATCH /v1/price-proposals/:id/reject',
      metodo: 'PATCH',
      ruta: () => `/v1/price-proposals/${UUID_FALSO}/reject`,
      token: () => precios,
      valido: () => ({ rejectionReason: 'No coincide con el mercado' }),
    },
    {
      nombre: 'POST /v1/price-observations',
      metodo: 'POST',
      ruta: () => '/v1/price-observations',
      token: () => analista,
      valido: () => ({ presentationId, storeId, price: 9.9, observedAt: '2026-10-01T12:00:00Z', lat: 25.68, lng: -100.31 }),
    },
    {
      nombre: 'PATCH /v1/price-observations/:id/approve',
      metodo: 'PATCH',
      ruta: () => `/v1/price-observations/${UUID_FALSO}/approve`,
      token: () => precios,
      valido: () => ({ effectiveDate: '2026-03-01' }),
    },
    {
      nombre: 'PATCH /v1/price-observations/:id/reject',
      metodo: 'PATCH',
      ruta: () => `/v1/price-observations/${UUID_FALSO}/reject`,
      token: () => precios,
      valido: () => ({ rejectionReason: 'Foto borrosa, no se lee el precio' }),
    },
    {
      nombre: 'PUT /v1/prices/alert-settings',
      metodo: 'PUT',
      ruta: () => '/v1/prices/alert-settings',
      token: () => precios,
      valido: () => ({ umbralPct: 5, ventanaDias: 30 }),
    },
  ];

  for (const c of cuerpos()) {
    it(`${c.nombre}: ningún valor hostil en ningún campo produce 5xx`, async () => {
      const campos = Object.keys(c.valido());
      const fallos: string[] = [];
      for (const campo of campos) {
        for (const [etiqueta, valor] of MALOS) {
          const cuerpo: Record<string, unknown> = { ...c.valido() };
          if (valor === undefined) delete cuerpo[campo];
          else cuerpo[campo] = valor;
          const r = await pedir(c.metodo, c.ruta(), { token: c.token(), cuerpo });
          try {
            exigirSano(r, `${c.nombre} ${campo}=${etiqueta}`);
          } catch (e) {
            fallos.push((e as Error).message);
          }
        }
      }
      expect(fallos).toEqual([]);
    });

    it(`${c.nombre}: cuerpo roto, vacío, de otro tipo o con campos de más no produce 5xx`, async () => {
      const casos: Array<[string, Parameters<typeof pedir>[2]]> = [
        ['JSON truncado', { token: c.token(), crudo: '{"a":', tipo: 'application/json' }],
        ['JSON con comillas simples', { token: c.token(), crudo: "{'a':1}", tipo: 'application/json' }],
        ['cuerpo vacío', { token: c.token(), crudo: '', tipo: 'application/json' }],
        ['arreglo en lugar de objeto', { token: c.token(), cuerpo: [c.valido()] }],
        ['null', { token: c.token(), crudo: 'null', tipo: 'application/json' }],
        ['número suelto', { token: c.token(), crudo: '42', tipo: 'application/json' }],
        ['texto plano', { token: c.token(), crudo: 'hola', tipo: 'text/plain' }],
        ['XML como cuerpo', { token: c.token(), crudo: '<a><b>1</b></a>', tipo: 'application/xml' }],
        ['form-urlencoded', { token: c.token(), crudo: 'a=1&b=2', tipo: 'application/x-www-form-urlencoded' }],
        ['sin content-type', { token: c.token(), crudo: JSON.stringify(c.valido()), tipo: '' }],
        ['campos de más (mass assignment)', { token: c.token(), cuerpo: { ...c.valido(), origen: 'interno', createdBy: 'x', id: UUID_FALSO, role: 'Administrador' } }],
        ['JSON profundamente anidado', { token: c.token(), crudo: '['.repeat(5000) + ']'.repeat(5000), tipo: 'application/json' }],
        ['accept raro', { token: c.token(), cuerpo: c.valido(), accept: 'application/x-nope' }],
        ['accept xml', { token: c.token(), cuerpo: c.valido(), accept: 'application/xml' }],
      ];
      const fallos: string[] = [];
      for (const [etiqueta, op] of casos) {
        const r = await pedir(c.metodo, c.ruta(), op);
        try {
          exigirSano(r, `${c.nombre} ${etiqueta}`);
        } catch (e) {
          fallos.push((e as Error).message);
        }
      }
      expect(fallos).toEqual([]);
    });
  }

  it('QA-PRI53-01/-19: una observación real aprobada con fecha imposible, y una propuesta de 1e15, dan 400 y no cambian nada', async () => {
    const obs = await pedir('POST', '/v1/price-observations', {
      token: analista,
      cuerpo: { presentationId, storeId, price: 9.9, observedAt: '2026-10-01T12:00:00Z' },
    });
    expect(obs.estado).toBe(201);
    for (const effectiveDate of ['2026-02-30', '2026-13-45', '0000-00-00', '2026-04-31']) {
      const r = await pedir('PATCH', `/v1/price-observations/${obs.json.id}/approve`, { token: precios, cuerpo: { effectiveDate } });
      expect(r.estado).toBe(400);
      exigirSano(r, `approve ${effectiveDate}`);
    }
    // sigue pendiente: ninguna aprobación fallida la consumió
    const pendiente = await pedir('GET', '/v1/price-observations?status=pendiente&limit=100', { token: precios });
    expect(pendiente.json.data.map((o: { id: string }) => o.id)).toContain(obs.json.id);

    for (const proposedPrice of [1e15, 1e308, 10_000_000_000]) {
      const r = await pedir('POST', '/v1/price-proposals', { token: proveedor, cuerpo: { presentationId, proposedPrice, purchaseUnit: 'caja' } });
      expect(r.estado).toBe(400);
    }
  });

  it('el cuerpo de 1 MB o más se rechaza con 413 y el error estándar, no con 500', async () => {
    const r = await pedir('POST', '/v1/prices', { token: precios, cuerpo: { presentationId, storeId, price: 1, nota: 'x'.repeat(1_200_000) } });
    expect(r.estado).toBe(413);
    exigirSano(r, '413');
  });

  // --------------------------------------------------------------------------------------------------------------
  // 2. Queries mal formadas en todas las lecturas
  // --------------------------------------------------------------------------------------------------------------
  it('las lecturas con queries hostiles nunca dan 5xx', async () => {
    const lecturas: Array<[string, () => string[]]> = [
      ['/v1/prices/history', () => [`productId=${productId}`, 'productId=', 'productId=abc', `productId=${UUID_FALSO}`, `productId=${productId}&productId=${UUID_FALSO}`, `productId[]=${productId}`]],
      ['/v1/prices/compare-zones', () => [`productId=${productId}`, 'productId=', 'productId=%00', `productId=${UUID_FALSO}`, "productId=' OR 1=1 --"]],
      ['/v1/prices/current', () => [`presentationId=${presentationId}`, 'presentationId=', `presentationId=${presentationId}&zoneId=abc`, `presentationId=${presentationId}&storeId=%00`, `presentationId=${UUID_FALSO}`]],
      ['/v1/prices/series', () => [`presentationId=${presentationId}`, `presentationId=${presentationId}&dateFrom=2026-13-45`, `presentationId=${presentationId}&dateTo=2026-02-30`, `presentationId=${presentationId}&dateFrom=9999-99-99`, `presentationId=${presentationId}&dateFrom=2026-12-01&dateTo=2026-01-01`, `presentationId=${presentationId}&dateFrom[]=x`, `presentationId=${presentationId}&limit=5`]],
      ['/v1/price-proposals', () => ['status=pendiente', 'status=otra', 'status=%00', 'status[]=pendiente']],
      ['/v1/price-observations', () => ['status=pendiente', 'status=otra', 'status=%00']],
      ['/v1/prices/alert-settings', () => ['', 'x=1']],
    ];
    const paginas = ['', 'page=0', 'page=-1', 'page=abc', 'page=1e9', 'page=99999999999999999999', 'limit=0', 'limit=-5', 'limit=abc', 'limit=1000000', 'limit=1.5', 'page=1&page=2'];
    const fallos: string[] = [];
    for (const [ruta, generar] of lecturas) {
      for (const q of generar()) {
        for (const p of ['', ...paginas]) {
          const consulta = [q, p].filter(Boolean).join('&');
          for (const accept of [undefined, 'application/xml']) {
            const r = await pedir('GET', `${ruta}${consulta ? `?${consulta}` : ''}`, { token: precios, accept });
            try {
              exigirSano(r, `GET ${ruta}?${consulta} (${accept ?? 'json'})`);
            } catch (e) {
              fallos.push((e as Error).message);
            }
          }
        }
      }
    }
    expect(fallos).toEqual([]);
  });

  it('ids de ruta que no son UUID o no existen: 400/404, nunca 500', async () => {
    const malos = ['abc', '123', UUID_FALSO, '%00', "' OR 1=1", '..%2f..%2fetc%2fpasswd', 'x'.repeat(5000), '1e10', '-1'];
    const fallos: string[] = [];
    for (const id of malos) {
      for (const [metodo, ruta, cuerpo] of [
        ['PATCH', `/v1/price-proposals/${id}/approve`, { storeIds: [storeId] }],
        ['PATCH', `/v1/price-proposals/${id}/reject`, { rejectionReason: 'motivo suficiente' }],
        ['PATCH', `/v1/price-observations/${id}/approve`, {}],
        ['PATCH', `/v1/price-observations/${id}/reject`, { rejectionReason: 'motivo suficiente' }],
      ] as Array<[string, string, object]>) {
        const r = await pedir(metodo, ruta, { token: precios, cuerpo });
        try {
          exigirSano(r, `${metodo} ${ruta.slice(0, 80)}`);
          if (id !== UUID_FALSO) expect([400, 404]).toContain(r.estado);
        } catch (e) {
          fallos.push((e as Error).message);
        }
      }
    }
    expect(fallos).toEqual([]);
  });

  // --------------------------------------------------------------------------------------------------------------
  // 3. Credenciales, métodos y rutas
  // --------------------------------------------------------------------------------------------------------------
  it('credenciales inválidas siempre dan 401 con el error estándar', async () => {
    const [cab, carga] = precios.split('.');
    const casos: Array<[string, Record<string, string>]> = [
      ['sin cabecera', {}],
      ['Bearer vacío', { Authorization: 'Bearer ' }],
      ['solo Bearer', { Authorization: 'Bearer' }],
      ['esquema Basic', { Authorization: 'Basic dXNlcjpwYXNz' }],
      ['token basura', { Authorization: 'Bearer abc' }],
      ['tres partes basura', { Authorization: 'Bearer a.b.c' }],
      ['firma recortada', { Authorization: `Bearer ${cab}.${carga}.` }],
      ['alg none', { Authorization: `Bearer ${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${carga}.` }],
      ['firmado con otro secreto', { Authorization: `Bearer ${sign({ sub: 'x', email: 'x@x', rol: 'Responsable de precios', rolId: 1, jti: 'j' }, 'otro-secreto', { expiresIn: '5m' })}` }],
      ['token enorme', { Authorization: `Bearer ${'a'.repeat(20_000)}` }],
      ['varias cabeceras', { Authorization: `Bearer ${precios}, Bearer x` }],
    ];
    const fallos: string[] = [];
    for (const [etiqueta, cabeceras] of casos) {
      for (const [metodo, ruta] of [['GET', '/v1/prices/history'], ['POST', '/v1/prices'], ['GET', '/v1/price-proposals'], ['PUT', '/v1/prices/alert-settings']]) {
        const r = await pedir(metodo, ruta, { cabeceras, cuerpo: metodo === 'GET' ? undefined : {} });
        if (r.estado === 431 && etiqueta === 'token enorme') continue; // Node corta cabeceras gigantes antes de la app
        if (r.estado !== 401) fallos.push(`${etiqueta} ${metodo} ${ruta} → ${r.estado}`);
        else {
          try {
            exigirSano(r, `${etiqueta} ${ruta}`);
          } catch (e) {
            fallos.push((e as Error).message);
          }
        }
      }
    }
    expect(fallos).toEqual([]);
  });

  it('un token válido cuya sesión se cerró en Redis da 401 (el JWT solo no basta)', async () => {
    const id = 'it-rb-sesion-cerrada';
    const t = await sesion(id, 'Responsable de precios');
    expect((await pedir('GET', '/v1/price-proposals', { token: t })).estado).toBe(200);
    await redis.del(`session:${id}`);
    expect((await pedir('GET', '/v1/price-proposals', { token: t })).estado).toBe(401);
  });

  it('un token revocado (revoked:{jti}) da 401', async () => {
    const id = 'it-rb-revocado';
    const t = await sesion(id, 'Responsable de precios');
    await redis.set(`revoked:jti-${id}`, '1', 'EX', 600);
    expect((await pedir('GET', '/v1/price-proposals', { token: t })).estado).toBe(401);
  });

  it('un rol sin permiso recibe 403 (no 500, no 200) en cada escritura', async () => {
    const fallos: string[] = [];
    for (const c of cuerpos()) {
      for (const [rol, token] of [['Auditor', auditor], ['Proveedor', proveedor], ['Analista', analista]] as Array<[string, string]>) {
        if (token === c.token()) continue;
        const r = await pedir(c.metodo, c.ruta(), { token, cuerpo: c.valido() });
        exigirSano(r, `${rol} ${c.nombre}`);
        // Quienes están en la lista de permitidos de este endpoint pueden pasar a validar; los demás, 403.
        const permitidos: Record<string, string[]> = {
          'POST /v1/price-observations': ['Analista'],
        };
        if (!(permitidos[c.nombre] ?? []).includes(rol) && r.estado !== 403) fallos.push(`${rol} en ${c.nombre} → ${r.estado} (esperaba 403)`);
      }
    }
    expect(fallos).toEqual([]);
  });

  it('métodos no soportados y rutas inexistentes dan 404/405 con error estándar, nunca 5xx', async () => {
    const fallos: string[] = [];
    for (const [metodo, ruta] of [
      ['DELETE', '/v1/prices'], ['PUT', '/v1/prices'], ['PATCH', '/v1/prices'], ['DELETE', '/v1/price-proposals'],
      ['POST', '/v1/prices/history'], ['GET', '/v1/prices/nope'], ['GET', '/v1/nope'], ['GET', '/v2/prices/history'],
      ['GET', '/v1/prices/%00'], ['GET', '/v1/../etc/passwd'], ['OPTIONS', '/v1/prices'],
    ]) {
      try {
        const r = await pedir(metodo, ruta, { token: precios });
        exigirSano(r, `${metodo} ${ruta}`);
      } catch (e) {
        fallos.push((e as Error).message);
      }
    }
    expect(fallos).toEqual([]);
  });

  it('GET /v1/health responde 200 sin token y no expone datos internos', async () => {
    const r = await pedir('GET', '/v1/health');
    expect(r.estado).toBe(200);
    expect(r.texto).not.toMatch(/password|secret|retail_pass/i);
  });

  // --------------------------------------------------------------------------------------------------------------
  // 4. Después del bombardeo: la base sigue íntegra
  // --------------------------------------------------------------------------------------------------------------
  it('tras todo lo anterior no quedan dos precios abiertos para una misma pareja ni precios fuera de rango', async () => {
    const duplicados = await db.query(
      `SELECT presentacion_id, tienda_id, count(*) FROM precios WHERE fecha_vigencia_hasta IS NULL
       GROUP BY presentacion_id, tienda_id HAVING count(*) > 1`,
    );
    expect(duplicados.rows).toEqual([]);
    const invalidos = await db.query('SELECT id FROM precios WHERE precio <= 0 OR fecha_vigencia_hasta < fecha_vigencia_desde');
    expect(invalidos.rows).toEqual([]);
  });
});
