/**
 * Integración de income-segmentation-service contra el servicio real.
 *
 * Requiere el stack con el seed cargado:
 *   docker compose -f infra/docker-compose.yml up -d \
 *     postgres redis catalog-service core-process-service income-segmentation-service
 *   npm run test:integracion
 *
 * No corre en CI (necesita infraestructura). Crea un segmento `ING_IT` y una
 * zona de prueba, y al terminar borra todo lo que creó: no toca el seed.
 */
import { BASE, CATALOG, conDb, errorDeXsd, http, redis, sesion } from './apoyo';

const CODIGO = 'ING_IT';
const ZONA = 'Zona integración segmentación';

const nuevo = {
  code: CODIGO,
  name: 'Segmento integración',
  incomeRangeMin: 900000,
  incomeRangeMax: 950000,
  source: 'Prueba de integración',
  updateFrequency: 'n/a',
  zoneRelation: 'Zona agregada (RN-02)',
  limitations: 'Solo para pruebas',
};

/**
 * El seed cubre de 0 a "sin tope" (ING_3 no tiene máximo), así que no queda
 * hueco para un segmento de prueba. Durante la corrida se le pone un tope a
 * ING_3 y al terminar se le quita: el seed queda como estaba.
 */
async function topeDeIng3(tope: number | null) {
  await conDb(async (db) => {
    await db.query("UPDATE segmentos_ingreso SET ingreso_max = $1 WHERE codigo = 'ING_3'", [tope]);
    await db.query(
      "UPDATE segmento_versiones SET ingreso_max = $1 WHERE vigente_hasta IS NULL AND segmento_id = (SELECT id FROM segmentos_ingreso WHERE codigo = 'ING_3')",
      [tope],
    );
  });
}

async function limpiar() {
  await conDb(async (db) => {
    await db.query('DELETE FROM zona_clasificaciones WHERE zona_id IN (SELECT id FROM zonas WHERE nombre = $1)', [ZONA]);
    await db.query('DELETE FROM zonas WHERE nombre = $1', [ZONA]);
    await db.query('DELETE FROM segmentos_ingreso WHERE codigo = $1', [CODIGO]);
  });
  await topeDeIng3(null);
}

describe('income-segmentation-service (integración, requiere stack)', () => {
  let analista: string;
  let admin: string;
  let auditor: string;
  let proveedor: string;
  let investigador: string;
  let analistaId: string;
  let segmentoId: number;
  let zonaId: string;

  beforeAll(async () => {
    await limpiar();
    await topeDeIng3(800000);
    ({ token: analista, id: analistaId } = await sesion('analista@retail.mx'));
    ({ token: admin } = await sesion('admin@retail.mx'));
    ({ token: auditor } = await sesion('auditor@retail.mx'));
    ({ token: proveedor } = await sesion('contacto@bioorganicos.mx'));
    const hayInvestigador = await conDb((db) =>
      db.query("SELECT u.email FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'Investigador de mercado' LIMIT 1"),
    );
    investigador = hayInvestigador.rows[0] ? (await sesion(hayInvestigador.rows[0].email)).token : '';

    // La zona es de catalog-service: se crea por su API (Administrador), no por SQL.
    const municipios = await http('GET', `${CATALOG}/v1/municipalities`, admin);
    const zona = await http('POST', `${CATALOG}/v1/zones`, admin, { nombre: ZONA, municipioId: municipios.cuerpo[0].id });
    expect(zona.estado).toBe(201);
    zonaId = zona.cuerpo.id;
  });

  afterAll(async () => {
    await limpiar();
    await redis.quit();
  });

  describe('sesión y permisos (Matriz §3.2)', () => {
    it('health responde sin sesión, con Postgres y Redis, y trae X-Correlation-Id', async () => {
      const r = await http('GET', `${BASE}/v1/health`);
      expect(r.estado).toBe(200);
      expect(r.cuerpo.checks).toMatchObject({ postgres: 'ok', redis: 'ok', mongodb: 'no configurado' });
      expect(r.correlacion).toBeTruthy();
    });

    it('sin token → 401 con el error estándar', async () => {
      const r = await http('GET', `${BASE}/v1/segments`);
      expect(r.estado).toBe(401);
      expect(r.cuerpo).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
    });

    it('el Proveedor y el Investigador de mercado no entran (403)', async () => {
      expect((await http('GET', `${BASE}/v1/segments`, proveedor)).estado).toBe(403);
      expect((await http('GET', `${BASE}/v1/zone-classifications`, proveedor)).estado).toBe(403);
      if (investigador) expect((await http('GET', `${BASE}/v1/segments`, investigador)).estado).toBe(403);
    });

    it('un perfil de lectura lee pero no escribe', async () => {
      expect((await http('GET', `${BASE}/v1/segments`, auditor)).estado).toBe(200);
      expect((await http('POST', `${BASE}/v1/segments`, auditor, nuevo)).estado).toBe(403);
      expect((await http('POST', `${BASE}/v1/segments`, admin, nuevo)).estado).toBe(403);
      expect((await http('PUT', `${BASE}/v1/zones/${zonaId}/classification`, admin, { segmentId: 1 })).estado).toBe(403);
    });
  });

  describe('segmentos versionados (D-35, D-10)', () => {
    it('los segmentos del seed salen de menor a mayor ingreso, cada uno con su versión', async () => {
      const r = await http('GET', `${BASE}/v1/segments`, analista);
      expect(r.estado).toBe(200);
      const codigos = r.cuerpo.data.map((s: { code: string }) => s.code);
      expect(codigos.slice(0, 3)).toEqual(['ING_1', 'ING_2', 'ING_3']);
      expect(r.cuerpo.data[0]).toMatchObject({ incomeRangeMin: '0.00', version: expect.any(Number) });
      expect(r.cuerpo.data[0].versionValidFrom).toBeTruthy();
    });

    it('validaciones del alta: negativo, mínimo mayor al máximo y campo desconocido → 400', async () => {
      expect((await http('POST', `${BASE}/v1/segments`, analista, { ...nuevo, incomeRangeMin: -1 })).estado).toBe(400);
      expect((await http('POST', `${BASE}/v1/segments`, analista, { ...nuevo, incomeRangeMin: 960000 })).estado).toBe(400);
      expect((await http('POST', `${BASE}/v1/segments`, analista, { ...nuevo, ingreso: 1 })).estado).toBe(400);
    });

    it('un rango encimado con otro segmento → 400 y dice con cuál choca (D-10)', async () => {
      const r = await http('POST', `${BASE}/v1/segments`, analista, { ...nuevo, incomeRangeMin: 10000, incomeRangeMax: 20000 });
      expect(r.estado).toBe(400);
      expect(r.cuerpo.code).toBe('VALIDATION_ERROR');
      expect(r.cuerpo.message).toMatch(/ING_1|ING_2/);
    });

    it('el alta crea la versión 1', async () => {
      const r = await http('POST', `${BASE}/v1/segments`, analista, nuevo);
      expect(r.estado).toBe(201);
      expect(r.cuerpo).toMatchObject({ code: CODIGO, incomeRangeMin: '900000.00', incomeRangeMax: '950000.00', version: 1 });
      segmentoId = r.cuerpo.id;
      const versiones = await http('GET', `${BASE}/v1/segments/${segmentoId}/versions`, analista);
      expect(versiones.cuerpo.total).toBe(1);
      expect(versiones.cuerpo.data[0]).toMatchObject({ version: 1, current: true, validTo: null, createdBy: analistaId });
    });

    it('código o nombre repetido → 409', async () => {
      const mismoCodigo = await http('POST', `${BASE}/v1/segments`, analista, { ...nuevo, name: 'Otro', incomeRangeMin: 960000, incomeRangeMax: 970000 });
      expect(mismoCodigo.estado).toBe(409);
      const mismoNombre = await http('POST', `${BASE}/v1/segments`, analista, { ...nuevo, code: 'ING_IT2', incomeRangeMin: 960000, incomeRangeMax: 970000 });
      expect(mismoNombre.estado).toBe(409);
    });

    it('el PATCH no acepta `code` (400): identifica al segmento entre versiones', async () => {
      const r = await http('PATCH', `${BASE}/v1/segments/${segmentoId}`, analista, { code: 'OTRO' });
      expect(r.estado).toBe(400);
    });

    it('mandar los mismos valores no crea versión', async () => {
      const r = await http('PATCH', `${BASE}/v1/segments/${segmentoId}`, analista, { name: nuevo.name, incomeRangeMax: 950000 });
      expect(r.estado).toBe(200);
      expect(r.cuerpo.version).toBe(1);
    });

    it('editar crea la versión 2 y la 1 sigue consultable (D-35)', async () => {
      const r = await http('PATCH', `${BASE}/v1/segments/${segmentoId}`, analista, {
        incomeRangeMax: 940000,
        source: 'Prueba de integración, segunda fuente',
        changeReason: 'Cambio de prueba',
      });
      expect(r.estado).toBe(200);
      expect(r.cuerpo).toMatchObject({ version: 2, incomeRangeMax: '940000.00' });

      const v1 = await http('GET', `${BASE}/v1/segments/${segmentoId}/versions/1`, auditor);
      expect(v1.estado).toBe(200);
      expect(v1.cuerpo).toMatchObject({ version: 1, incomeRangeMax: '950000.00', source: 'Prueba de integración', current: false });
      expect(v1.cuerpo.validTo).toBeTruthy();

      const lista = await http('GET', `${BASE}/v1/segments/${segmentoId}/versions`, auditor);
      expect(lista.cuerpo.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);
      expect(lista.cuerpo.data[0]).toMatchObject({ current: true, changeReason: 'Cambio de prueba' });
    });

    it('al editar, el rango resultante tampoco puede encimarse (400) y no crea versión', async () => {
      const r = await http('PATCH', `${BASE}/v1/segments/${segmentoId}`, analista, { incomeRangeMin: 100 });
      expect(r.estado).toBe(400);
      expect((await http('GET', `${BASE}/v1/segments/${segmentoId}`, analista)).cuerpo.version).toBe(2);
    });

    it('segmento o versión inexistente → 404; id no numérico → 400; id fuera de rango → 404, no 500', async () => {
      expect((await http('GET', `${BASE}/v1/segments/31999`, analista)).estado).toBe(404);
      expect((await http('GET', `${BASE}/v1/segments/99999999`, analista)).estado).toBe(404);
      expect((await http('GET', `${BASE}/v1/segments/abc`, analista)).estado).toBe(400);
      expect((await http('GET', `${BASE}/v1/segments/${segmentoId}/versions/9`, analista)).estado).toBe(404);
    });
  });

  describe('clasificación de zonas con su versión (D-35)', () => {
    let primera: string;

    it('una zona sin clasificar: 404 en la vigente y lista vacía en el historial', async () => {
      expect((await http('GET', `${BASE}/v1/zones/${zonaId}/classification`, analista)).estado).toBe(404);
      const historial = await http('GET', `${BASE}/v1/zones/${zonaId}/classification/history`, analista);
      expect(historial.cuerpo).toMatchObject({ data: [], total: 0 });
    });

    it('zona inexistente → 404 (se valida en catalog-service); segmento inexistente → 400; zoneId no UUID → 400', async () => {
      const fantasma = '00000000-0000-4000-8000-000000000000';
      expect((await http('PUT', `${BASE}/v1/zones/${fantasma}/classification`, analista, { segmentId: segmentoId })).estado).toBe(404);
      expect((await http('PUT', `${BASE}/v1/zones/${zonaId}/classification`, analista, { segmentId: 31999 })).estado).toBe(400);
      expect((await http('PUT', `${BASE}/v1/zones/no-es-uuid/classification`, analista, { segmentId: segmentoId })).estado).toBe(400);
      expect((await http('PUT', `${BASE}/v1/zones/${zonaId}/classification`, analista, { segmentId: segmentoId, extra: 1 })).estado).toBe(400);
    });

    it('clasificar guarda el segmento y su versión vigente (2)', async () => {
      const r = await http('PUT', `${BASE}/v1/zones/${zonaId}/classification`, analista, { segmentId: segmentoId });
      expect(r.estado).toBe(200);
      expect(r.cuerpo).toMatchObject({
        zoneId: zonaId,
        segmentId: segmentoId,
        segmentCode: CODIGO,
        segmentVersion: 2,
        segmentCurrentVersion: 2,
        origin: 'manual',
        current: true,
        validTo: null,
        assignedBy: analistaId,
      });
      primera = r.cuerpo.id;
    });

    it('volver a clasificar igual no cambia nada', async () => {
      const r = await http('PUT', `${BASE}/v1/zones/${zonaId}/classification`, analista, { segmentId: segmentoId });
      expect(r.cuerpo.id).toBe(primera);
      expect((await http('GET', `${BASE}/v1/zones/${zonaId}/classification/history`, analista)).cuerpo.total).toBe(1);
    });

    it('editar el segmento NO mueve la clasificación ya hecha: conserva su versión y su nombre', async () => {
      const editado = await http('PATCH', `${BASE}/v1/segments/${segmentoId}`, analista, { name: 'Segmento integración v3' });
      expect(editado.cuerpo.version).toBe(3);
      const vigente = await http('GET', `${BASE}/v1/zones/${zonaId}/classification`, auditor);
      expect(vigente.cuerpo).toMatchObject({ id: primera, segmentVersion: 2, segmentCurrentVersion: 3, segmentName: 'Segmento integración' });
    });

    it('reclasificar adopta la versión nueva, cierra la anterior y conserva el historial', async () => {
      const r = await http('PUT', `${BASE}/v1/zones/${zonaId}/classification`, analista, { segmentId: segmentoId });
      expect(r.cuerpo.id).not.toBe(primera);
      expect(r.cuerpo).toMatchObject({ segmentVersion: 3, segmentName: 'Segmento integración v3', current: true });

      const historial = await http('GET', `${BASE}/v1/zones/${zonaId}/classification/history`, analista);
      expect(historial.cuerpo.total).toBe(2);
      const cerrada = historial.cuerpo.data.find((c: { id: string }) => c.id === primera);
      expect(cerrada).toMatchObject({ current: false, segmentVersion: 2 });
      expect(cerrada.validTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('el listado filtra por zona, por vigencia y por fecha (asOf)', async () => {
      const vigentes = await http('GET', `${BASE}/v1/zone-classifications?zoneId=${zonaId}&current=true`, analista);
      expect(vigentes.cuerpo.total).toBe(1);
      const cerradas = await http('GET', `${BASE}/v1/zone-classifications?zoneId=${zonaId}&current=false`, analista);
      expect(cerradas.cuerpo.total).toBe(1);

      const hoy = (await conDb((db) => db.query("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS hoy"))).rows[0].hoy;
      const aHoy = await http('GET', `${BASE}/v1/zone-classifications?zoneId=${zonaId}&asOf=${hoy}`, analista);
      expect(aHoy.cuerpo.data.map((c: { segmentVersion: number }) => c.segmentVersion)).toEqual([3]);
      const antes = await http('GET', `${BASE}/v1/zone-classifications?zoneId=${zonaId}&asOf=2020-01-01`, analista);
      expect(antes.cuerpo.total).toBe(0);

      expect((await http('GET', `${BASE}/v1/zone-classifications?asOf=${hoy}&current=true`, analista)).estado).toBe(400);
      expect((await http('GET', `${BASE}/v1/zone-classifications?asOf=2026-02-30`, analista)).estado).toBe(400);
      expect((await http('GET', `${BASE}/v1/zone-classifications?page=1000001`, analista)).estado).toBe(400);
    });

    it('un segmento con historial de clasificaciones no se borra (409)', async () => {
      const r = await http('DELETE', `${BASE}/v1/segments/${segmentoId}`, analista);
      expect(r.estado).toBe(409);
      expect(r.cuerpo.code).toBe('CONFLICT');
    });
  });

  describe('publicación de agregados (D-36)', () => {
    it('una fila por zona clasificada; si no es publicable, sin número y con motivo', async () => {
      const r = await http('GET', `${BASE}/v1/publication/zone-segments`, analista);
      expect(r.estado).toBe(200);
      expect(r.cuerpo).toMatchObject({ minTransactions: 10, minStores: 3, rule: 'ambos' });
      expect(r.cuerpo.data.length).toBeGreaterThanOrEqual(1);
      for (const fila of r.cuerpo.data) {
        if (fila.disponible) {
          expect(typeof fila.averageTicket).toBe('number');
          expect(fila.motivo).toBeNull();
          expect(fila.transactions).toBeGreaterThanOrEqual(10);
          expect(fila.stores).toBeGreaterThanOrEqual(3);
        } else {
          expect(fila.averageTicket).toBeNull();
          expect(fila.motivo).toMatch(/D-36/);
        }
      }
    });

    it('la zona de prueba no tiene ventas ni tiendas: no disponible, nunca 0', async () => {
      const r = await http('GET', `${BASE}/v1/publication/zone-segments?zoneId=${zonaId}`, analista);
      expect(r.cuerpo.data).toHaveLength(1);
      expect(r.cuerpo.data[0]).toMatchObject({
        zoneId: zonaId,
        segmentCode: CODIGO,
        segmentVersion: 3,
        transactions: 0,
        stores: 0,
        disponible: false,
        averageTicket: null,
      });
    });

    it('fechas invertidas o mal formadas → 400', async () => {
      expect((await http('GET', `${BASE}/v1/publication/zone-segments?dateFrom=2026-09-01&dateTo=2026-08-01`, analista)).estado).toBe(400);
      expect((await http('GET', `${BASE}/v1/publication/zone-segments?dateFrom=ayer`, analista)).estado).toBe(400);
    });
  });

  describe('XML contra el XSD del contrato', () => {
    const XML = 'application/xml';
    const rutas: Array<[string, () => string, string]> = [
      ['lista de segmentos', () => `${BASE}/v1/segments`, 'segmentListResponse'],
      ['un segmento', () => `${BASE}/v1/segments/${segmentoId}`, 'segmentResponse'],
      ['un segmento sin tope ni descripción nula', () => `${BASE}/v1/segments/3`, 'segmentResponse'],
      ['versiones', () => `${BASE}/v1/segments/${segmentoId}/versions`, 'segmentVersionListResponse'],
      ['una versión cerrada', () => `${BASE}/v1/segments/${segmentoId}/versions/1`, 'segmentVersionResponse'],
      ['clasificaciones', () => `${BASE}/v1/zone-classifications`, 'zoneClassificationListResponse'],
      ['clasificación vigente', () => `${BASE}/v1/zones/${zonaId}/classification`, 'zoneClassificationResponse'],
      ['historial de una zona', () => `${BASE}/v1/zones/${zonaId}/classification/history`, 'zoneClassificationListResponse'],
      ['publicación', () => `${BASE}/v1/publication/zone-segments`, 'publicationResponse'],
      ['error 404', () => `${BASE}/v1/segments/31999`, 'error'],
      ['error 400 con detalle', () => `${BASE}/v1/zone-classifications?page=0`, 'error'],
    ];

    it.each(rutas)('%s valida', async (_nombre, url, raiz) => {
      const r = await http('GET', url(), analista, undefined, XML);
      expect(r.texto).toContain(`<${raiz} xmlns="segmentation/v1"`);
      const error = errorDeXsd(r.texto);
      if (error === 'sin-validador') {
        console.warn('Sin Python + lxml: no se validó el XML contra el XSD.');
        return;
      }
      expect(error).toBeNull();
    });

    it('el PUT de clasificación también responde XML válido', async () => {
      const r = await http('PUT', `${BASE}/v1/zones/${zonaId}/classification`, analista, { segmentId: segmentoId }, XML);
      expect(r.estado).toBe(200);
      const error = errorDeXsd(r.texto);
      if (error !== 'sin-validador') expect(error).toBeNull();
    });
  });
});
