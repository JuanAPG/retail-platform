/**
 * Integración de availability-service contra el servicio real.
 *
 * Requiere el stack con el seed cargado:
 *   docker compose -f infra/docker-compose.yml up -d \
 *     postgres redis catalog-service availability-service
 *   npm run test:integracion
 *
 * No corre en CI (necesita infraestructura). Crea por la API de catalog una
 * zona, una tienda y tres productos de canasta básica de prueba, y al
 * terminar borra todo lo que creó: no toca el inventario del seed.
 */
import { randomUUID } from 'crypto';
import { BASE, CATALOG, conDb, errorDeXsd, http, redis, sesion } from './apoyo';

const ZONA = 'IT disponibilidad zona';
const TIENDA = 'IT disponibilidad tienda';
const SKU = 'IT-DISP-';
const DIA = 24 * 3600 * 1000;
const hace = (ms: number) => new Date(Date.now() - ms).toISOString();

async function limpiar() {
  await conDb(async (db) => {
    const tiendas = await db.query('SELECT id, direccion_id FROM tiendas WHERE nombre = $1', [TIENDA]);
    const ids = tiendas.rows.map((t) => t.id);
    await db.query('DELETE FROM disponibilidad_capturas WHERE tienda_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM inventario WHERE tienda_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM tiendas WHERE id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM direcciones WHERE id = ANY($1::uuid[])', [tiendas.rows.map((t) => t.direccion_id)]);
    await db.query('DELETE FROM productos WHERE sku LIKE $1', [`${SKU}%`]);
    await db.query('DELETE FROM zonas WHERE nombre = $1', [ZONA]);
  });
}

describe('availability-service (integración, requiere stack)', () => {
  let analista: string;
  let analistaId: string;
  let admin: string;
  let auditor: string;
  let gerente: string;
  let proveedor: string;
  let investigador = '';
  let zonaId: string;
  let tiendaId: string;
  /** Tres básicos de prueba: Arroz (1 presentación), Frijol (2) y Huevo (1). */
  const producto: Record<string, { id: string; presentaciones: string[] }> = {};

  const capturar = (token: string, cuerpo: object, accept?: string) =>
    http('POST', `${BASE}/v1/availability/captures`, token, cuerpo, accept);

  beforeAll(async () => {
    await limpiar();
    ({ token: analista, id: analistaId } = await sesion('analista@retail.mx'));
    ({ token: admin } = await sesion('admin@retail.mx'));
    ({ token: auditor } = await sesion('auditor@retail.mx'));
    ({ token: gerente } = await sesion('gercategoria@retail.mx'));
    ({ token: proveedor } = await sesion('contacto@bioorganicos.mx'));
    const campo = await conDb((db) =>
      db.query("SELECT u.email FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE r.nombre = 'Investigador de mercado' AND u.activo LIMIT 1"),
    );
    if (campo.rows[0]) investigador = (await sesion(campo.rows[0].email)).token;

    // Todo lo de catálogo se crea por la API de catalog-service, no por SQL.
    const municipios = await http('GET', `${CATALOG}/v1/municipalities`, admin);
    const zona = await http('POST', `${CATALOG}/v1/zones`, admin, { nombre: ZONA, municipioId: municipios.cuerpo[0].id });
    expect(zona.estado).toBe(201);
    zonaId = zona.cuerpo.id;

    const postales = await http('GET', `${CATALOG}/v1/stores/catalog/postal-codes`, admin);
    const tienda = await http('POST', `${CATALOG}/v1/stores`, admin, {
      nombre: TIENDA,
      formato: 'minimarket',
      zonaId,
      calle: 'Calle de prueba',
      codigoPostal: postales.cuerpo[0].codigoPostal,
    });
    expect(tienda.estado).toBe(201);
    tiendaId = tienda.cuerpo.id;

    const categorias = await http('GET', `${CATALOG}/v1/product-categories`, gerente);
    for (const nombre of ['Arroz', 'Frijol', 'Huevo']) {
      const alta = await http('POST', `${CATALOG}/v1/products`, gerente, {
        sku: `${SKU}${nombre.toUpperCase()}`,
        nombre: `IT básico ${nombre}`,
        categoriaId: categorias.cuerpo[0].id,
        esCanastaBasica: true,
        presentacion: 'Presentación A',
        contenido: 1,
        unidadMedida: 'kg',
      });
      expect(alta.estado).toBe(201);
      producto[nombre] = { id: alta.cuerpo.id, presentaciones: [alta.cuerpo.presentaciones[0].id] };
    }
    const segunda = await http('POST', `${CATALOG}/v1/products/${producto.Frijol.id}/presentations`, gerente, {
      nombre: 'Presentación B',
      contenido: 2,
      unidadMedida: 'kg',
    });
    expect(segunda.estado).toBe(201);
    producto.Frijol.presentaciones.push(segunda.cuerpo.id);
  });

  afterAll(async () => {
    await limpiar();
    await redis.quit();
  });

  describe('sesión y permisos (Matriz §3.2)', () => {
    it('health responde sin sesión, con Postgres y Redis, y trae X-Correlation-Id', async () => {
      const r = await http('GET', `${BASE}/v1/health`);
      expect(r.estado).toBe(200);
      expect(r.cuerpo).toMatchObject({ service: 'availability-service', checks: { postgres: 'ok', redis: 'ok' } });
      expect(r.correlacion).toBeTruthy();
    });

    it('sin token → 401; Proveedor → 403 en todo', async () => {
      expect((await http('GET', `${BASE}/v1/availability/stock`)).estado).toBe(401);
      expect((await http('GET', `${BASE}/v1/availability/stock`, proveedor)).estado).toBe(403);
      expect((await capturar(proveedor, { storeId: tiendaId, presentationId: producto.Arroz.presentaciones[0], stock: 1 })).estado).toBe(403);
    });

    it('un perfil de lectura consulta pero no captura', async () => {
      expect((await http('GET', `${BASE}/v1/availability/stock`, auditor)).estado).toBe(200);
      expect((await capturar(auditor, { storeId: tiendaId, presentationId: producto.Arroz.presentaciones[0], stock: 1 })).estado).toBe(403);
      expect((await capturar(admin, { storeId: tiendaId, presentationId: producto.Arroz.presentaciones[0], stock: 1 })).estado).toBe(403);
    });
  });

  describe('capturas (D-38, D-42)', () => {
    const arroz = () => producto.Arroz.presentaciones[0];
    const idDispositivo = randomUUID();
    const vista = hace(2 * 3600 * 1000);

    it('validaciones → 400: existencia negativa, fecha futura, campo desconocido, id no UUID', async () => {
      const base = { storeId: tiendaId, presentationId: arroz(), stock: 5 };
      expect((await capturar(analista, { ...base, stock: -1 })).estado).toBe(400);
      expect((await capturar(analista, { ...base, capturedAt: new Date(Date.now() + DIA).toISOString() })).estado).toBe(400);
      expect((await capturar(analista, { ...base, cantidad: 3 })).estado).toBe(400);
      expect((await capturar(analista, { ...base, storeId: 'tienda-1' })).estado).toBe(400);
      expect((await capturar(analista, { ...base, origin: 'fax' })).estado).toBe(400);
    });

    it('tienda o presentación inexistente → 400, no 500', async () => {
      const r = await capturar(analista, { storeId: randomUUID(), presentationId: arroz(), stock: 5 });
      expect(r.estado).toBe(400);
      expect(r.cuerpo.code).toBe('VALIDATION_ERROR');
    });

    it('la primera captura se acepta (201) y queda como existencia actual', async () => {
      const r = await capturar(analista, { captureId: idDispositivo, storeId: tiendaId, presentationId: arroz(), stock: 5, capturedAt: vista, origin: 'movil' });
      expect(r.estado).toBe(201);
      expect(r.cuerpo).toMatchObject({
        captureId: idDispositivo,
        status: 'aceptada',
        stock: 5,
        origin: 'movil',
        capturedBy: analistaId,
        currentStock: 5,
        reason: null,
      });
      expect(new Date(r.cuerpo.currentCapturedAt).toISOString()).toBe(vista);
    });

    it('reenviar la misma captura no la duplica: 200 `duplicada` (D-42)', async () => {
      const r = await capturar(analista, { captureId: idDispositivo, storeId: tiendaId, presentationId: arroz(), stock: 5, capturedAt: vista });
      expect(r.estado).toBe(200);
      expect(r.cuerpo).toMatchObject({ captureId: idDispositivo, status: 'duplicada', stock: 5, currentStock: 5 });
      const bitacora = await http('GET', `${BASE}/v1/availability/captures?storeId=${tiendaId}&presentationId=${arroz()}`, analista);
      expect(bitacora.cuerpo.total).toBe(1);
    });

    it('un captureId de otro usuario → 409', async () => {
      if (!investigador) return;
      const r = await capturar(investigador, { captureId: idDispositivo, storeId: tiendaId, presentationId: arroz(), stock: 9 });
      expect(r.estado).toBe(409);
    });

    it('una captura MÁS VIEJA que el dato del servidor queda en conflicto y no sobrescribe (D-42)', async () => {
      const r = await capturar(analista, { storeId: tiendaId, presentationId: arroz(), stock: 99, capturedAt: hace(3 * DIA) });
      expect(r.estado).toBe(201);
      expect(r.cuerpo).toMatchObject({ status: 'conflicto', stock: 99, currentStock: 5 });
      expect(r.cuerpo.reason).toMatch(/D-42/);
      const stock = await http('GET', `${BASE}/v1/availability/stock?storeId=${tiendaId}&presentationId=${arroz()}`, analista);
      expect(stock.cuerpo.data[0].stock).toBe(5);
    });

    it('una captura más reciente sí actualiza; sin capturedAt cuenta como ahora', async () => {
      const r = await capturar(analista, { storeId: tiendaId, presentationId: arroz(), stock: 7 });
      expect(r.estado).toBe(201);
      expect(r.cuerpo).toMatchObject({ status: 'aceptada', currentStock: 7, origin: 'web' });
    });

    it('el Investigador de mercado captura (D-28) pero no lee', async () => {
      if (!investigador) {
        console.warn('El seed no tiene un usuario Investigador de mercado: no se probó su alta.');
        return;
      }
      const r = await capturar(investigador, { storeId: tiendaId, presentationId: producto.Frijol.presentaciones[0], stock: 0, origin: 'movil' });
      expect(r.estado).toBe(201);
      expect(r.cuerpo.status).toBe('aceptada');
      expect((await http('GET', `${BASE}/v1/availability/stock`, investigador)).estado).toBe(403);
      expect((await http('GET', `${BASE}/v1/availability/stores/${tiendaId}/coverage`, investigador)).estado).toBe(403);
    });

    it('la bitácora filtra por estado', async () => {
      const conflictos = await http('GET', `${BASE}/v1/availability/captures?storeId=${tiendaId}&status=conflicto`, auditor);
      expect(conflictos.cuerpo.total).toBe(1);
      expect(conflictos.cuerpo.data[0]).toMatchObject({ status: 'conflicto', stock: 99 });
      expect(conflictos.cuerpo.data[0].currentStock).toBeUndefined();
      expect((await http('GET', `${BASE}/v1/availability/captures?status=duplicada`, auditor)).estado).toBe(400);
    });
  });

  describe('existencias, cobertura y faltantes (D-38)', () => {
    beforeAll(async () => {
      // Frijol: Presentación A en 0 y Presentación B en 3 → cubierto. Huevo: dato de hace 8 días → vencido.
      await capturar(analista, { storeId: tiendaId, presentationId: producto.Frijol.presentaciones[0], stock: 0 });
      await capturar(analista, { storeId: tiendaId, presentationId: producto.Frijol.presentaciones[1], stock: 3 });
      const viejo = await capturar(analista, { storeId: tiendaId, presentationId: producto.Huevo.presentaciones[0], stock: 10, capturedAt: hace(8 * DIA) });
      expect(viejo.cuerpo.status).toBe('aceptada');
    });

    it('un dato de hace 8 días sale vencido, no disponible', async () => {
      const r = await http('GET', `${BASE}/v1/availability/stock?storeId=${tiendaId}&presentationId=${producto.Huevo.presentaciones[0]}`, analista);
      expect(r.cuerpo.data[0]).toMatchObject({ stock: 10, ageDays: 8, status: 'vencido' });
    });

    it('el listado filtra por estado', async () => {
      const por = async (estado: string) =>
        (await http('GET', `${BASE}/v1/availability/stock?storeId=${tiendaId}&status=${estado}`, analista)).cuerpo;
      expect((await por('vencido')).total).toBe(1);
      expect((await por('agotado')).total).toBe(1);
      expect((await por('disponible')).total).toBe(2);
      expect((await http('GET', `${BASE}/v1/availability/stock?status=lleno`, analista)).estado).toBe(400);
    });

    it('cobertura de la tienda: cada básico con su estado y el % sobre TODOS los básicos del catálogo', async () => {
      const r = await http('GET', `${BASE}/v1/availability/stores/${tiendaId}/coverage`, analista);
      expect(r.estado).toBe(200);
      const estado = (id: string) => r.cuerpo.items.find((i: { productId: string }) => i.productId === id);
      expect(estado(producto.Arroz.id)).toMatchObject({ status: 'cubierto', presentationsWithStock: 1 });
      expect(estado(producto.Frijol.id)).toMatchObject({ status: 'cubierto', presentationsWithStock: 1 });
      expect(estado(producto.Huevo.id)).toMatchObject({ status: 'vencido', presentationsWithStock: 0 });
      // Los básicos del seed no tienen datos en esta tienda: cuentan en el total, como sin dato.
      expect(r.cuerpo).toMatchObject({ validDays: 7, covered: 2, missing: 0, expired: 1, disponible: true, motivo: null });
      expect(r.cuerpo.basics).toBe(r.cuerpo.covered + r.cuerpo.missing + r.cuerpo.expired + r.cuerpo.noData);
      expect(r.cuerpo.coverage).toBe(Math.round((2 / r.cuerpo.basics) * 10000) / 100);
    });

    it('cuando se agota la única presentación con existencia, el básico pasa a faltante', async () => {
      await capturar(analista, { storeId: tiendaId, presentationId: producto.Frijol.presentaciones[1], stock: 0 });
      const cobertura = await http('GET', `${BASE}/v1/availability/stores/${tiendaId}/coverage`, analista);
      expect(cobertura.cuerpo).toMatchObject({ covered: 1, missing: 1 });

      const faltan = await http('GET', `${BASE}/v1/availability/shortages?storeId=${tiendaId}`, analista);
      expect(faltan.estado).toBe(200);
      expect(faltan.cuerpo).toMatchObject({ storeId: tiendaId, validDays: 7 });
      expect(faltan.cuerpo.data).toEqual([
        expect.objectContaining({ productId: producto.Frijol.id, storeId: tiendaId }),
      ]);
    });

    it('cobertura de la zona: una tienda, con % de tiendas que tienen cada básico', async () => {
      const r = await http('GET', `${BASE}/v1/availability/zones/${zonaId}/coverage`, auditor);
      expect(r.estado).toBe(200);
      expect(r.cuerpo).toMatchObject({ zoneId: zonaId, stores: 1, covered: 1, disponible: true });
      const estado = (id: string) => r.cuerpo.items.find((i: { productId: string }) => i.productId === id);
      expect(estado(producto.Arroz.id)).toMatchObject({ status: 'cubierto', storesWithStock: 1, storeShare: 100 });
      expect(estado(producto.Frijol.id)).toMatchObject({ status: 'faltante', storesWithStock: 0, storeShare: 0 });
      expect(r.cuerpo.byStore).toEqual([expect.objectContaining({ storeId: tiendaId, disponible: true, covered: 1, missing: 1 })]);

      const faltan = await http('GET', `${BASE}/v1/availability/shortages?zoneId=${zonaId}`, auditor);
      expect(faltan.cuerpo.zoneId).toBe(zonaId);
      expect(faltan.cuerpo.storeId).toBeUndefined();
      expect(faltan.cuerpo.data).toHaveLength(1);
    });

    it('faltantes exige exactamente un filtro; tienda o zona inexistente → 404', async () => {
      expect((await http('GET', `${BASE}/v1/availability/shortages`, analista)).estado).toBe(400);
      expect((await http('GET', `${BASE}/v1/availability/shortages?storeId=${tiendaId}&zoneId=${zonaId}`, analista)).estado).toBe(400);
      expect((await http('GET', `${BASE}/v1/availability/shortages?storeId=${randomUUID()}`, analista)).estado).toBe(404);
      expect((await http('GET', `${BASE}/v1/availability/stores/${randomUUID()}/coverage`, analista)).estado).toBe(404);
      expect((await http('GET', `${BASE}/v1/availability/zones/${randomUUID()}/coverage`, analista)).estado).toBe(404);
      expect((await http('GET', `${BASE}/v1/availability/zones/zona-1/coverage`, analista)).estado).toBe(400);
    });
  });

  describe('XML contra el XSD del contrato', () => {
    const XML = 'application/xml';
    const validar = (xml: string) => {
      const error = errorDeXsd(xml);
      if (error === 'sin-validador') {
        console.warn('Sin Python + lxml: no se validó el XML contra el XSD.');
        return;
      }
      expect(error).toBeNull();
    };
    const rutas: Array<[string, () => string, string]> = [
      ['bitácora de capturas', () => `${BASE}/v1/availability/captures?storeId=${tiendaId}`, 'captureListResponse'],
      ['existencias', () => `${BASE}/v1/availability/stock?storeId=${tiendaId}`, 'stockListResponse'],
      ['existencias del seed', () => `${BASE}/v1/availability/stock`, 'stockListResponse'],
      ['cobertura de tienda', () => `${BASE}/v1/availability/stores/${tiendaId}/coverage`, 'storeCoverageResponse'],
      ['cobertura de zona', () => `${BASE}/v1/availability/zones/${zonaId}/coverage`, 'zoneCoverageResponse'],
      ['faltantes por tienda', () => `${BASE}/v1/availability/shortages?storeId=${tiendaId}`, 'shortageListResponse'],
      ['faltantes por zona', () => `${BASE}/v1/availability/shortages?zoneId=${zonaId}`, 'shortageListResponse'],
      ['error 400', () => `${BASE}/v1/availability/shortages`, 'error'],
      ['error 404', () => `${BASE}/v1/availability/stores/${randomUUID()}/coverage`, 'error'],
    ];

    it.each(rutas)('%s valida', async (_nombre, url, raiz) => {
      const r = await http('GET', url(), analista, undefined, XML);
      expect(r.texto).toContain(`<${raiz} xmlns="availability/v1"`);
      validar(r.texto);
    });

    it('las tres respuestas del POST (aceptada, duplicada, conflicto) validan', async () => {
      const captureId = randomUUID();
      const cuerpo = { captureId, storeId: tiendaId, presentationId: producto.Huevo.presentaciones[0], stock: 4 };
      const aceptada = await capturar(analista, cuerpo, XML);
      expect(aceptada.estado).toBe(201);
      expect(aceptada.texto).toContain('<status>aceptada</status>');
      validar(aceptada.texto);

      const duplicada = await capturar(analista, cuerpo, XML);
      expect(duplicada.estado).toBe(200);
      expect(duplicada.texto).toContain('<status>duplicada</status>');
      validar(duplicada.texto);

      const conflicto = await capturar(analista, { ...cuerpo, captureId: randomUUID(), capturedAt: hace(2 * DIA) }, XML);
      expect(conflicto.texto).toContain('<status>conflicto</status>');
      validar(conflicto.texto);
    });

    it('una zona sin tiendas: no disponible, sin `coverage`, y el XML valida', async () => {
      const municipios = await http('GET', `${CATALOG}/v1/municipalities`, admin);
      const vacia = await http('POST', `${CATALOG}/v1/zones`, admin, { nombre: `${ZONA} vacía`, municipioId: municipios.cuerpo[0].id });
      try {
        const json = await http('GET', `${BASE}/v1/availability/zones/${vacia.cuerpo.id}/coverage`, analista);
        expect(json.cuerpo).toMatchObject({ stores: 0, disponible: false, coverage: null });
        expect(json.cuerpo.motivo).toMatch(/tiendas activas/);
        const xml = await http('GET', `${BASE}/v1/availability/zones/${vacia.cuerpo.id}/coverage`, analista, undefined, XML);
        expect(xml.texto).not.toContain('<coverage>');
        validar(xml.texto);
      } finally {
        await conDb((db) => db.query('DELETE FROM zonas WHERE id = $1', [vacia.cuerpo.id]));
      }
    });
  });
});
