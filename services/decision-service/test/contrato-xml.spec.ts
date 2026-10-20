/**
 * Contrato XML de decision-service contra el servicio real: cada respuesta
 * pedida con `Accept: application/xml` debe traer la raíz que declara el
 * `@XmlRoot` de su endpoint y validar contra
 * `docs/contratos/decision-service.xsd` (el cliente de escritorio es
 * XML-exclusivo y valida con ese XSD).
 *
 * Requiere el stack local con el seed:
 *   docker compose -f infra/docker-compose.yml up -d postgres redis auth-service catalog-service \
 *     core-process-service algorithms-core audit-service decision-service
 *   npm run test:integracion
 * y xmllint o Python 3 con lxml para validar (ver `apoyo.ts`).
 *
 * Solo corre contra la base LOCAL: `generate` reemplaza las recomendaciones
 * en 'propuesta' de la zona evaluada. Al terminar borra lo que creó
 * (escenarios, recomendaciones, corridas de accesibilidad) y restaura las
 * 'propuesta' que `generate` haya reemplazado. Los eventos de la bitácora
 * se quedan: es append-only, nadie los borra.
 */
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AUTH, BASE, CUENTAS, crearDb, entrar, esperarXmlValido, http, validadorXsd } from './apoyo';

const XML = 'application/xml';
type Fila = Record<string, unknown>;

function valor(xml: string, etiqueta: string): string | undefined {
  return new RegExp(`<${etiqueta}>([^<]*)</${etiqueta}>`).exec(xml)?.[1];
}

describe('Contrato XML contra el XSD (integración)', () => {
  let db: DataSource;
  let planeador: string;
  let gerente: string;
  let analista: string;

  const escenarios: string[] = [];
  const corridasAccesibilidad: string[] = [];
  /** Zonas que crea la prueba del historial vacío; se borran al terminar. */
  const zonasPropias: string[] = [];
  let recomendacionesPrevias: string[] = [];
  let propuestasPrevias: Fila[] = [];
  let evidenciasPrevias: Fila[] = [];
  /** Recomendación propia de la prueba: no depende de que `generate` dispare alguna regla. */
  let recomendacionPropia: string;
  let zonaId: string;

  beforeAll(async () => {
    const hosts = [new URL(BASE).hostname, new URL(AUTH).hostname, process.env.DB_HOST ?? 'localhost'];
    const ajeno = hosts.find((h) => h !== 'localhost' && h !== '127.0.0.1');
    if (ajeno) throw new Error(`Estas pruebas escriben y borran datos: solo corren contra el stack local, no contra "${ajeno}".`);

    // Falla aquí, con el mensaje de qué instalar, antes de crear nada.
    validadorXsd();

    db = crearDb();
    await db.initialize();
    [planeador, gerente, analista] = await Promise.all([
      entrar(CUENTAS.Planeador),
      entrar(CUENTAS.Gerente),
      entrar(CUENTAS.Analista),
    ]);

    recomendacionesPrevias = (await db.query('SELECT id FROM recomendaciones')).map((f: { id: string }) => f.id);
    propuestasPrevias = await db.query(`SELECT * FROM recomendaciones WHERE estatus = 'propuesta'`);
    evidenciasPrevias = await db.query(
      `SELECT e.* FROM recomendacion_evidencias e JOIN recomendaciones r ON r.id = e.recomendacion_id
       WHERE r.estatus = 'propuesta'`,
    );

    const [zona]: { id: string }[] = await db.query(
      `SELECT z.id FROM zonas z ORDER BY EXISTS (SELECT 1 FROM accesibilidad_zona a WHERE a.zona_id = z.id) DESC, z.id LIMIT 1`,
    );
    if (!zona) throw new Error('La base no tiene zonas: carga el seed (db/data_retail.sql).');
    zonaId = zona.id;

    const [propia]: { id: string }[] = await db.query(
      `INSERT INTO recomendaciones (titulo, que_recomienda, por_que, impacto_estimado)
       VALUES ($1, 'Prueba de integración.', 'Para validar el contrato XML.', 'Ninguno: se borra al terminar.')
       RETURNING id`,
      [`IT contrato-xml ${Date.now()}`],
    );
    recomendacionPropia = propia.id;
    await db.query(
      `INSERT INTO recomendacion_evidencias (recomendacion_id, dimension, referencia_id, descripcion)
       VALUES ($1, 'zona', $2, 'Evidencia de la prueba de integración.')`,
      [recomendacionPropia, zonaId],
    );
  });

  afterAll(async () => {
    if (!db?.isInitialized) return;
    try {
      // Primero las recomendaciones: pueden apuntar a escenarios y corridas de la prueba.
      await db.query('DELETE FROM recomendaciones WHERE id <> ALL($1::uuid[])', [recomendacionesPrevias]);
      for (const r of propuestasPrevias) {
        await db.query(
          `INSERT INTO recomendaciones (id, corrida_id, escenario_id, zona_id, titulo, que_recomienda, por_que,
                                        impacto_estimado, estatus, generada_en)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.corrida_id, r.escenario_id, r.zona_id, r.titulo, r.que_recomienda, r.por_que, r.impacto_estimado, r.estatus, r.generada_en],
        );
      }
      for (const e of evidenciasPrevias) {
        await db.query(
          `INSERT INTO recomendacion_evidencias (recomendacion_id, dimension, referencia_id, descripcion)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [e.recomendacion_id, e.dimension, e.referencia_id, e.descripcion],
        );
      }
      // `escenario_cambios` y `escenario_resultados` se van con el escenario; índice, pesos,
      // componentes y parámetros, con la corrida (ON DELETE CASCADE).
      if (escenarios.length > 0) await db.query('DELETE FROM escenarios WHERE id = ANY($1::uuid[])', [escenarios]);
      if (corridasAccesibilidad.length > 0) {
        await db.query(`DELETE FROM analisis_corridas WHERE id = ANY($1::uuid[]) AND tipo = 'accesibilidad'`, [corridasAccesibilidad]);
      }
      // Al final: la zona solo se puede borrar cuando ya no la referencia nada.
      if (zonasPropias.length > 0) {
        await db.query('DELETE FROM zonas WHERE id = ANY($1::uuid[])', [zonasPropias]);
      }
    } finally {
      await db.destroy();
    }
  });

  /** Producto con 3 o más presentaciones activas con precio vigente (D-14). */
  async function productoComparable(): Promise<{ productId: string; presentationIds: string[] }> {
    const [fila]: { productId: string; presentationIds: string[] }[] = await db.query(
      `SELECT pp.producto_id AS "productId", array_agg(DISTINCT pp.id::text) AS "presentationIds"
       FROM producto_presentaciones pp
       JOIN precios p ON p.presentacion_id = pp.id AND p.vigente
       WHERE pp.activo
       GROUP BY pp.producto_id
       HAVING count(DISTINCT pp.id) >= 3
       ORDER BY pp.producto_id LIMIT 1`,
    );
    if (!fila) {
      throw new Error('Ningún producto tiene 3 o más presentaciones activas con precio vigente (D-14): carga el seed o registra precios.');
    }
    return fila;
  }

  async function compararPresentaciones(accept?: string) {
    const r = await http('POST', '/v1/simulation/presentation', planeador, { cuerpo: await productoComparable(), accept });
    const scenarioId = accept ? valor(r.texto, 'scenarioId') : (JSON.parse(r.texto) as { scenarioId?: string }).scenarioId;
    if (scenarioId) escenarios.push(scenarioId);
    return r;
  }

  it('POST /v1/simulation/price → simulacionPrecioResponse', async () => {
    const [fila]: { presentationId: string; zoneId: string; precio: number }[] = await db.query(
      `SELECT e.presentacion_id AS "presentationId", t.zona_id AS "zoneId", AVG(p.precio)::float8 AS precio
       FROM elasticidades e
       JOIN analisis_corridas c ON c.id = e.corrida_id AND c.tipo = 'elasticidad' AND c.estado = 'completada'
       JOIN precios p ON p.presentacion_id = e.presentacion_id AND p.vigente
       JOIN tiendas t ON t.id = p.tienda_id
       WHERE e.zona_id IS NULL OR e.zona_id = t.zona_id
       GROUP BY e.presentacion_id, t.zona_id
       ORDER BY e.presentacion_id, t.zona_id LIMIT 1`,
    );
    if (!fila) {
      throw new Error(
        'Requiere correr elasticidad antes: ninguna presentación con precio vigente tiene elasticidad calculada. ' +
          'Corre POST /v1/elasticity/calculate en algorithms-core (Responsable de precios) y vuelve a correr la prueba.',
      );
    }

    const r = await http('POST', '/v1/simulation/price', planeador, {
      cuerpo: { presentationId: fila.presentationId, zoneId: fila.zoneId, newPrice: Number((fila.precio * 1.1).toFixed(2)) },
      accept: XML,
    });
    const scenarioId = valor(r.texto, 'scenarioId');
    if (scenarioId) escenarios.push(scenarioId);

    expect(r.estado).toBe(201);
    esperarXmlValido(r.texto, 'simulacionPrecioResponse');
  });

  it('POST /v1/simulation/presentation → simulacionPresentacionResponse', async () => {
    const r = await compararPresentaciones(XML);

    expect(r.estado).toBe(201);
    esperarXmlValido(r.texto, 'simulacionPresentacionResponse');
  });

  it('GET /v1/simulation/scenarios → simulacionEscenariosResponse', async () => {
    const r = await http('GET', '/v1/simulation/scenarios', planeador, { accept: XML });

    expect(r.estado).toBe(200);
    esperarXmlValido(r.texto, 'simulacionEscenariosResponse');
  });

  it('GET /v1/simulation/compare?ids=a,b → simulacionCompareResponse', async () => {
    // Usa los escenarios de las pruebas anteriores; si alguna no llegó a crear el suyo, crea los que falten.
    while (escenarios.length < 2) {
      const creado = await compararPresentaciones();
      expect(creado.estado).toBe(201);
    }

    const r = await http('GET', `/v1/simulation/compare?ids=${escenarios.slice(0, 2).join(',')}`, planeador, { accept: XML });

    expect(r.estado).toBe(200);
    esperarXmlValido(r.texto, 'simulacionCompareResponse');
  });

  it('GET /v1/accessibility/by-zone/:zoneId → historialAccesibilidad', async () => {
    const corridas = async (): Promise<string[]> =>
      (await db.query('SELECT corrida_id AS id FROM accesibilidad_zona WHERE zona_id = $1', [zonaId])).map((f: { id: string }) => f.id);

    const previas = await corridas();
    if (previas.length === 0) {
      // La zona no tiene corrida: se crea una (GET /index calcula y persiste) y se borra al final.
      const [segmento]: { id: number }[] = await db.query('SELECT id FROM segmentos_ingreso ORDER BY id LIMIT 1');
      if (!segmento) throw new Error('La base no tiene segmentos de ingreso: carga el seed (db/data_retail.sql).');
      const creada = await http('GET', `/v1/accessibility/index?zoneId=${zonaId}&segmentId=${segmento.id}`, analista, { accept: XML });
      corridasAccesibilidad.push(...(await corridas()));
      expect(creada.estado).toBe(200);
      esperarXmlValido(creada.texto, 'indiceAccesibilidad');
    }

    const r = await http('GET', `/v1/accessibility/by-zone/${zonaId}`, planeador, { accept: XML });

    expect(r.estado).toBe(200);
    esperarXmlValido(r.texto, 'historialAccesibilidad');
    // Es el historial: trae al menos un <item>, no los campos pelados.
    expect(r.texto).toContain('<item>');
  });

  /**
   * Fallo #10 del 13-oct-2026: la pantalla de accesibilidad del web registraba
   * un 404 al abrir una zona sin corridas. El contrato nunca definió un 404
   * para esta ruta: una zona que existe y no tiene corridas es `200` con la
   * lista vacía, y el XML tiene que seguir validando contra el XSD.
   */
  it('by-zone de una zona SIN corridas → 200 con historial vacío (no 404)', async () => {
    const [sinCorridas]: { id: string }[] = await db.query(
      `SELECT z.id FROM zonas z
       WHERE NOT EXISTS (SELECT 1 FROM accesibilidad_zona a WHERE a.zona_id = z.id)
       LIMIT 1`,
    );
    if (!sinCorridas) {
      // Todas las zonas del seed ya tienen corrida: se crea una zona propia y
      // se borra al terminar, para no depender del estado de la base.
      const [municipio]: { id: number }[] = await db.query('SELECT id FROM municipios ORDER BY id LIMIT 1');
      if (!municipio) throw new Error('La base no tiene municipios: carga el seed (db/data_retail.sql).');
      const [creada]: { id: string }[] = await db.query(
        `INSERT INTO zonas (nombre, municipio_id, descripcion, activo)
         VALUES ($1, $2, 'Zona de la prueba de contrato XML.', true) RETURNING id`,
        [`IT by-zone vacia ${Date.now()}`, municipio.id],
      );
      zonasPropias.push(creada.id);
      const r = await http('GET', `/v1/accessibility/by-zone/${creada.id}`, planeador, { accept: XML });
      expect(r.estado).toBe(200);
      esperarXmlValido(r.texto, 'historialAccesibilidad');
      expect(r.texto).not.toContain('<item>');
      return;
    }

    const r = await http('GET', `/v1/accessibility/by-zone/${sinCorridas.id}`, planeador, { accept: XML });
    expect(r.estado).toBe(200);
    esperarXmlValido(r.texto, 'historialAccesibilidad');
    expect(r.texto).not.toContain('<item>');
  });

  it('by-zone de una zona INEXISTENTE sigue siendo 404 en XML válido', async () => {
    const r = await http('GET', '/v1/accessibility/by-zone/00000000-0000-4000-8000-000000000000', planeador, {
      accept: XML,
    });

    expect(r.estado).toBe(404);
    esperarXmlValido(r.texto, 'error');
  });

  it('POST /v1/recommendations/generate → recomendacionesResponse', async () => {
    // Con zona: acota lo que `generate` reemplaza a las 'propuesta' de esa zona.
    const r = await http('POST', '/v1/recommendations/generate', planeador, { cuerpo: { zoneId: zonaId }, accept: XML });

    expect(r.estado).toBe(201);
    esperarXmlValido(r.texto, 'recomendacionesResponse');
  });

  it('GET /v1/recommendations → recomendacionesPageResponse', async () => {
    const r = await http('GET', '/v1/recommendations', planeador, { accept: XML });

    expect(r.estado).toBe(200);
    esperarXmlValido(r.texto, 'recomendacionesPageResponse');
  });

  it('GET /v1/recommendations/:id/explain → recomendacion', async () => {
    const r = await http('GET', `/v1/recommendations/${recomendacionPropia}/explain`, planeador, { accept: XML });

    expect(r.estado).toBe(200);
    esperarXmlValido(r.texto, 'recomendacion');
    expect(valor(r.texto, 'status')).toBe('propuesta');
  });

  it('PATCH /v1/recommendations/:id/approve (Gerente) → recomendacion', async () => {
    const r = await http('PATCH', `/v1/recommendations/${recomendacionPropia}/approve`, gerente, { accept: XML });

    expect(r.estado).toBe(200);
    esperarXmlValido(r.texto, 'recomendacion');
    expect(valor(r.texto, 'status')).toBe('aceptada');
  });

  it('un 400 pedido en XML → error', async () => {
    const r = await http('POST', '/v1/simulation/price', planeador, { cuerpo: {}, accept: XML });

    expect(r.estado).toBe(400);
    esperarXmlValido(r.texto, 'error');
    expect(valor(r.texto, 'statusCode')).toBe('400');
  });

  it('un 404 pedido en XML → error', async () => {
    const r = await http('GET', `/v1/recommendations/${randomUUID()}/explain`, planeador, { accept: XML });

    expect(r.estado).toBe(404);
    esperarXmlValido(r.texto, 'error');
    expect(valor(r.texto, 'statusCode')).toBe('404');
  });
});
