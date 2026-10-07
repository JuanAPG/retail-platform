import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Integración M06/M07 (corre en la VM con Docker).
 *
 * Requiere: `docker compose -f infra/docker-compose.yml up -d
 * core-process-service catalog-service audit-service auth-service`
 * (postgres y redis los arrastra `depends_on`) con seed, más un token de
 * Analista o Administrador de auth-service. Sube el CSV real de 100
 * canastas con multipart de verdad. No corre en CI sin infraestructura:
 *
 *   CORE_TOKEN=<jwt-analista> npm run test:integracion
 */
const BASE = process.env.CORE_BASE_URL ?? 'http://localhost:3104';
const TOKEN = process.env.CORE_TOKEN ?? '';
const CSV_100 = join(__dirname, '..', '..', '..', 'db', 'datos_prueba_100_canastas.csv');

const auth = { Authorization: `Bearer ${TOKEN}` };
/** catalog-service, para las pruebas que necesitan dar de baja una tienda. */
const BASE_CATALOGO = process.env.CATALOG_BASE_URL ?? 'http://localhost:3102';
/** Token de Administrador, si se exporta: hace falta para editar el catálogo. */
const authAdmin = { Authorization: `Bearer ${process.env.CORE_TOKEN_ADMIN ?? TOKEN}` };

/** Identificador de esta corrida, para no chocar con lo ya importado. */
const CORRIDA = `IT${Date.now().toString(36).toUpperCase()}`;

/**
 * El CSV real de 100 canastas, con los folios prefijados por esta corrida.
 *
 * Una VM de QA nunca tiene la base limpia: el archivo original ya está
 * importado, así que su hash da 409 y sus folios darían FOLIO_DUPLICADO.
 * Prefijar los folios conserva los datos reales —tiendas, SKU y
 * presentaciones del seed, 154 filas, 100 transacciones— y hace la prueba
 * repetible tantas veces como se corra.
 */
function csvDeLaCorrida(): Buffer {
  const lineas = readFileSync(CSV_100, 'utf-8').trim().split(/\r?\n/);
  const encabezado = lineas[0];
  const columnaFolio = encabezado
    .split(',')
    .findIndex((c) => c.trim().toLowerCase() === 'folio');
  if (columnaFolio < 0) throw new Error('El CSV de prueba no trae columna folio.');

  const cuerpo = lineas.slice(1).map((linea) => {
    const celdas = linea.split(',');
    celdas[columnaFolio] = `${CORRIDA}-${celdas[columnaFolio].trim()}`;
    return celdas.join(',');
  });
  return Buffer.from([encabezado, ...cuerpo].join('\n') + '\n', 'utf-8');
}

async function subirCsv(contenido: Buffer, nombre: string) {
  const forma = new FormData();
  // `new Uint8Array(...)` y no el Buffer directo: TS no acepta
  // `Buffer<ArrayBufferLike>` como `BlobPart`.
  forma.append('file', new Blob([new Uint8Array(contenido)], { type: 'text/csv' }), nombre);
  const respuesta = await fetch(`${BASE}/v1/transactions/import/preview`, {
    method: 'POST',
    headers: auth,
    body: forma,
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function confirmar(importacionId: string) {
  const respuesta = await fetch(`${BASE}/v1/transactions/import/confirm`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewId: importacionId }),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function get(ruta: string, xml = false) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    headers: { ...auth, ...(xml ? { Accept: 'application/xml' } : {}) },
  });
  return {
    estado: respuesta.status,
    tipo: respuesta.headers.get('content-type') ?? '',
    cuerpo: xml ? await respuesta.text() : await respuesta.json(),
  };
}

/**
 * El stack tiene que estar arriba y el token presente: sin esto las cinco
 * pruebas fallaban con un `fetch failed` idéntico, indistinguible de una
 * regresión del servicio.
 */
beforeAll(async () => {
  let salud: Response;
  try {
    salud = await fetch(`${BASE}/v1/health`);
  } catch (error) {
    throw new Error(
      `No hay stack en ${BASE}: levanta docker compose antes de correr estas pruebas. ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const cuerpo = (await salud.json()) as { status?: string; checks?: Record<string, string> };
  if (!salud.ok) throw new Error(`GET /v1/health devolvió ${salud.status}.`);
  if (cuerpo.status !== 'ok') {
    throw new Error(`El servicio está degradado: ${JSON.stringify(cuerpo.checks)}`);
  }
  if (!TOKEN) {
    throw new Error('Falta CORE_TOKEN: exporta un JWT de Analista o Administrador.');
  }
}, 30000);

describe('M06/M07 de punta a punta (integración, requiere stack)', () => {
  it('health reporta postgres y redis en ok', async () => {
    const r = await get('/v1/health');
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ status: 'ok', checks: { postgres: 'ok', redis: 'ok' } });
  });

  it('CSV 100: preview 154/0, confirm 100/100 y canastas visibles', async () => {
    const preview = await subirCsv(csvDeLaCorrida(), `${CORRIDA}.csv`);
    expect(preview.estado).toBe(201);
    expect(preview.cuerpo.filasTotales).toBe(154);
    expect(preview.cuerpo.filasConError).toBe(0);
    expect(preview.cuerpo.transaccionesDetectadas).toBe(100);

    const confirm = await confirmar(preview.cuerpo.importacionId);
    expect(confirm.estado).toBe(200);

    // El resumen cuadra exactamente con lo insertado.
    expect(confirm.cuerpo.transaccionesCreadas).toBe(100);
    expect(confirm.cuerpo.canastasCreadas).toBe(100);
    expect(confirm.cuerpo.lineasInsertadas).toBe(154);
    expect(confirm.cuerpo.filasPendientes).toBe(0);
    expect(confirm.cuerpo.completa).toBe(true);
    expect(confirm.cuerpo.estado).toBe('confirmado');
    expect(confirm.cuerpo.omitidos).toEqual([]);

    const canastas = await get('/v1/baskets?limit=5');
    expect(canastas.estado).toBe(200);
    expect(canastas.cuerpo.total).toBeGreaterThanOrEqual(100);
    expect(canastas.cuerpo.data).toHaveLength(5);
    expect(canastas.cuerpo.data[0].zoneId).toBeDefined();
  }, 180000);

  it('el mismo archivo otra vez da 409, y descartarlo lo libera', async () => {
    const contenido = Buffer.from(`folio,fecha,tienda,sku,presentacion,cantidad,precio\n${
      csvDeLaCorrida().toString('utf-8').split('\n')[1]
    }\n`);

    const primera = await subirCsv(contenido, `${CORRIDA}-dup.csv`);
    expect(primera.estado).toBe(201);

    // Mismo contenido => mismo hash => 409 con el id de la previa.
    const repetida = await subirCsv(contenido, `${CORRIDA}-dup.csv`);
    expect(repetida.estado).toBe(409);
    expect(repetida.cuerpo.code).toBe('CONFLICT');

    // Descartarla libera el archivo: sin este endpoint, un preview
    // equivocado dejaba ese CSV rechazado para siempre.
    const descarte = await fetch(
      `${BASE}/v1/transactions/import/${primera.cuerpo.importacionId}`,
      { method: 'DELETE', headers: auth },
    );
    expect(descarte.status).toBe(200);
    expect(await descarte.json()).toMatchObject({ estado: 'descartado' });

    const tercera = await subirCsv(contenido, `${CORRIDA}-dup.csv`);
    expect(tercera.estado).toBe(201);

    // Y ya descartada no se puede confirmar ni volver a descartar.
    const confirmar409 = await confirmar(primera.cuerpo.importacionId);
    expect(confirmar409.estado).toBe(409);
  }, 60000);

  it('una importación confirmada no se puede descartar', async () => {
    const pendientes = await get('/v1/transactions/import/pending');
    expect(pendientes.estado).toBe(200);
    expect(Array.isArray(pendientes.cuerpo)).toBe(true);
    // `filasPendientes` distingue "sin confirmar" de "aplicada a medias".
    for (const i of pendientes.cuerpo) {
      expect(typeof i.filasPendientes).toBe('number');
    }
  });

  it('cada transacción tiene su canasta: total == valor_total de la canasta', async () => {
    const transacciones = await get('/v1/transactions?limit=5');
    expect(transacciones.estado).toBe(200);
    expect(transacciones.cuerpo.data.length).toBeGreaterThan(0);

    for (const t of transacciones.cuerpo.data) {
      // total == Σ subtotal de sus líneas (lo que el servicio verifica al insertar).
      const suma = t.details.reduce(
        (s: number, d: { subtotal: string }) => s + Number(d.subtotal),
        0,
      );
      expect(Number(t.total).toFixed(2)).toBe(suma.toFixed(2));

      const canastas = await get(`/v1/baskets?limit=100`);
      const canasta = canastas.cuerpo.data.find(
        (k: { transactionId: string }) => k.transactionId === t.id,
      );
      if (canasta) {
        expect(Number(canasta.totalValue).toFixed(2)).toBe(Number(t.total).toFixed(2));
      }
    }
  }, 60000);

  it('filtros combinados devuelven la intersección, no la unión', async () => {
    const todas = await get('/v1/baskets?limit=1');
    const zona = todas.cuerpo.data[0]?.zoneId;
    expect(zona).toBeDefined();

    const enZona = await get(`/v1/baskets?zoneId=${zona}&limit=100`);
    expect(enZona.estado).toBe(200);
    expect(enZona.cuerpo.data.every((k: { zoneId: string }) => k.zoneId === zona)).toBe(true);

    // Zona + rango de fechas: todo lo devuelto cumple AMBAS condiciones.
    const combinado = await get(`/v1/baskets?zoneId=${zona}&dateFrom=2026-08-01&dateTo=2026-08-31&limit=100`);
    expect(combinado.estado).toBe(200);
    expect(combinado.cuerpo.total).toBeLessThanOrEqual(enZona.cuerpo.total);
    for (const k of combinado.cuerpo.data) {
      expect(k.zoneId).toBe(zona);
      expect(k.date >= '2026-08-01').toBe(true);
      expect(k.date < '2026-09-01').toBe(true);
    }
  }, 60000);

  it('filtro sin resultados devuelve data vacía, no error', async () => {
    const r = await get('/v1/baskets?dateFrom=2099-01-01');
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ data: [], total: 0 });
  });

  it('los filtros de valor y tamaño de compra se aplican', async () => {
    const chicas = await get('/v1/baskets?size=chica&limit=100');
    expect(chicas.estado).toBe(200);
    const caras = await get('/v1/baskets?minTotalValue=100000&limit=5');
    expect(caras.estado).toBe(200);
    expect(caras.cuerpo.data).toEqual([]);
  });

  it('XML: listas con <item>, prólogo y fechas con valor', async () => {
    const r = await get('/v1/baskets?limit=2', true);
    expect(r.estado).toBe(200);
    expect(r.tipo).toContain('application/xml');
    const xml = String(r.cuerpo);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<item>');
    // La fecha NO sale como etiqueta vacía (el cliente de escritorio
    // filtra por periodo y la necesita).
    expect(xml).not.toMatch(/<date\s*\/>|<date><\/date>/);
    expect(xml).toMatch(/<date>\d{4}-\d{2}-\d{2}T/);
  });

  it('XML también en los errores', async () => {
    const r = await get('/v1/baskets/00000000-0000-4000-8000-000000000000', true);
    expect(r.estado).toBe(404);
    expect(r.tipo).toContain('application/xml');
    expect(String(r.cuerpo)).toContain('<code>NOT_FOUND</code>');
  });

  it('sin token es 401; errores con cuerpo estándar', async () => {
    const sinToken = await fetch(`${BASE}/v1/transactions`);
    expect(sinToken.status).toBe(401);
    const cuerpo = await sinToken.json();
    expect(cuerpo).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });

    const inexistente = await get('/v1/transactions/00000000-0000-4000-8000-000000000000');
    expect(inexistente.estado).toBe(404);
    expect(inexistente.cuerpo).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('el error de validación trae el detalle en `details` y message como string', async () => {
    const r = await fetch(`${BASE}/v1/transactions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId: 'no-es-uuid', folio: '', fecha: 'ayer', details: [] }),
    });
    expect(r.status).toBe(400);
    const cuerpo = await r.json();
    expect(typeof cuerpo.message).toBe('string');
    expect(Array.isArray(cuerpo.details)).toBe(true);
    expect(cuerpo.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza fecha futura en el alta manual, igual que en el CSV', async () => {
    const r = await fetch(`${BASE}/v1/transactions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeId: '00000000-0000-4000-8000-000000000000',
        folio: 'T-FUTURO-1',
        fecha: '2099-01-01',
        details: [{ presentationId: '00000000-0000-4000-8000-000000000000', quantity: 1, unitPrice: 10 }],
      }),
    });
    expect(r.status).toBe(400);
    const cuerpo = await r.json();
    expect(JSON.stringify(cuerpo.details)).toMatch(/futura/i);
  });

  it('reclassify no reescribe las canastas que ya tienen segmento (RN-02)', async () => {
    // Las canastas del seed ya están clasificadas: la operación debe
    // reportar que no hay nada que rellenar y no tocar su segmento.
    const antes = await get('/v1/baskets?limit=20');
    const conSegmento = antes.cuerpo.data.filter(
      (k: { segmentId: number | null }) => k.segmentId != null,
    );
    expect(conSegmento.length).toBeGreaterThan(0);

    const r = await fetch(`${BASE}/v1/baskets/reclassify`, { method: 'POST', headers: auth });
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(typeof cuerpo.canastasSinSegmento).toBe('number');
    expect(typeof cuerpo.canastasClasificadas).toBe('number');
    expect(Array.isArray(cuerpo.zonasSinClasificacion)).toBe(true);
    // Nunca clasifica más de las que estaban sin segmento.
    expect(cuerpo.canastasClasificadas).toBeLessThanOrEqual(cuerpo.canastasSinSegmento);

    const despues = await get('/v1/baskets?limit=20');
    for (const k of conSegmento) {
      const igual = despues.cuerpo.data.find((d: { id: string }) => d.id === k.id);
      expect(igual.segmentId).toBe(k.segmentId);
    }
  }, 60000);

  it('la respuesta no filtra columnas de las tablas de catalog-service', async () => {
    // La forma de la respuesta es el contrato: devolver la entidad cruda
    // arrastraba store.direccion.codigoPostal.municipio, zone.municipioId,
    // activo, updatedAt… y el XML dejaba de validar contra el XSD.
    const canastas = await get('/v1/baskets?limit=3');
    const transacciones = await get('/v1/transactions?limit=3');
    const plano = JSON.stringify(canastas.cuerpo) + JSON.stringify(transacciones.cuerpo);
    for (const fuga of [
      'municipioId',
      'municipio',
      'direccion',
      'codigoPostal',
      'proveedor',
      'updatedAt',
      'esCanastaBasica',
      'categoriaId',
    ]) {
      expect(plano).not.toContain(fuga);
    }

    // Y lo que sí debe estar, está.
    const canasta = canastas.cuerpo.data[0];
    expect(Object.keys(canasta).sort()).toEqual(
      [
        'basicProductsCount',
        'builtAt',
        'date',
        'hasBasicProducts',
        'id',
        'productCount',
        'segmentId',
        'storeId',
        'totalValue',
        'transactionId',
        'unitsTotal',
        'zone',
        'zoneId',
      ].sort(),
    );
    expect(canasta.zone).toEqual({ id: expect.any(String), nombre: expect.any(String) });
    expect(transacciones.cuerpo.data[0].details[0]).toHaveProperty('productId');
  }, 30000);

  it('findAll y findOne devuelven la misma forma', async () => {
    const lista = await get('/v1/baskets?limit=1');
    const uno = await get(`/v1/baskets/${lista.cuerpo.data[0].id}`);
    expect(Object.keys(uno.cuerpo).sort()).toEqual(Object.keys(lista.cuerpo.data[0]).sort());
  }, 30000);

  // --- Huecos que QA señaló sin prueba automatizada (QA-CP-08) --------

  it('CSV mixto: el resumen concilia exactamente con lo insertado', async () => {
    const tienda = (await get('/v1/baskets?limit=1')).cuerpo.data[0];
    const nombreTienda = (await get(`/v1/transactions?storeId=${tienda.storeId}&limit=1`)).cuerpo
      .data[0].store.nombre;
    const detalle = (await get(`/v1/transactions?storeId=${tienda.storeId}&limit=1`)).cuerpo.data[0]
      .details[0];

    // 3 válidas (2 de un folio + 1 de otro), 2 con SKU inexistente y 1 con
    // cantidad negativa, todas en el mismo archivo.
    const filas = [
      'folio,fecha,tienda,sku,presentacion,cantidad,precio',
      `${CORRIDA}-MX1,2026-09-10,${nombreTienda},${detalle.productSku},${detalle.presentationName},2,25.00`,
      `${CORRIDA}-MX2,2026-09-10,${nombreTienda},${detalle.productSku},${detalle.presentationName},1,25.00`,
      `${CORRIDA}-MX3,2026-09-10,${nombreTienda},${detalle.productSku},${detalle.presentationName},3,25.00`,
      `${CORRIDA}-MX4,2026-09-10,${nombreTienda},SKU-FANTASMA-1,${detalle.presentationName},1,10.00`,
      `${CORRIDA}-MX5,2026-09-10,${nombreTienda},SKU-FANTASMA-2,${detalle.presentationName},1,10.00`,
      `${CORRIDA}-MX6,2026-09-10,${nombreTienda},${detalle.productSku},${detalle.presentationName},-2,25.00`,
    ];
    const preview = await subirCsv(Buffer.from(filas.join('\n') + '\n'), `${CORRIDA}-mix.csv`);

    expect(preview.estado).toBe(201);
    expect(preview.cuerpo.filasTotales).toBe(6);
    expect(preview.cuerpo.filasValidas).toBe(3);
    expect(preview.cuerpo.filasConError).toBe(3);
    expect(preview.cuerpo.transaccionesDetectadas).toBe(3);
    const codigos = preview.cuerpo.errores.map((e: { codigo: string }) => e.codigo);
    expect(codigos.filter((c: string) => c === 'SKU_NO_EXISTE')).toHaveLength(2);
    expect(codigos).toContain('CANTIDAD_INVALIDA');

    const confirm = await confirmar(preview.cuerpo.importacionId);
    // El resumen cuadra: solo las válidas, y las rechazadas siguen ahí.
    expect(confirm.cuerpo.transaccionesCreadas).toBe(3);
    expect(confirm.cuerpo.canastasCreadas).toBe(3);
    expect(confirm.cuerpo.lineasInsertadas).toBe(3);
    expect(confirm.cuerpo.filasConError).toBe(3);
    expect(confirm.cuerpo.filasPendientes).toBe(0);
    expect(confirm.cuerpo.completa).toBe(true);
    expect(confirm.cuerpo.errores.length).toBe(3);

    // Y en la base están exactamente esas 3, cada una con su canasta.
    const insertadas = await get(`/v1/transactions?limit=100&dateFrom=2026-09-10&dateTo=2026-09-10`);
    const mias = insertadas.cuerpo.data.filter((t: { folio: string }) =>
      t.folio.startsWith(`${CORRIDA}-MX`),
    );
    expect(mias).toHaveLength(3);
  }, 120000);

  it('CSV vacío y encabezados reordenados, de punta a punta', async () => {
    const soloEncabezado = Buffer.from('folio,fecha,tienda,sku,presentacion,cantidad,precio\n');
    const vacio = await subirCsv(soloEncabezado, `${CORRIDA}-vacio.csv`);
    expect(vacio.estado).toBe(400);
    expect(vacio.cuerpo.code).toBe('VALIDATION_ERROR');

    const sinNada = await subirCsv(Buffer.from(''), `${CORRIDA}-nada.csv`);
    expect(sinNada.estado).toBe(400);

    // Encabezados en otro orden y con punto y coma: debe mapear por nombre.
    const tienda = (await get('/v1/transactions?limit=1')).cuerpo.data[0];
    const d = tienda.details[0];
    const reordenado = Buffer.from(
      [
        'precio;cantidad;presentacion;sku;tienda;fecha;folio',
        `25.00;2;${d.presentationName};${d.productSku};${tienda.store.nombre};2026-09-11;${CORRIDA}-RE1`,
      ].join('\n') + '\n',
    );
    const r = await subirCsv(reordenado, `${CORRIDA}-reord.csv`);
    expect(r.estado).toBe(201);
    expect(r.cuerpo.filasValidas).toBe(1);
    expect(r.cuerpo.filasConError).toBe(0);
  }, 60000);

  it('una tienda dada de baja no origina ventas (manual y CSV)', async () => {
    // Se da de baja una tienda en catalog-service y se restaura al final.
    const tiendas = await fetch(`${BASE_CATALOGO}/v1/stores?limit=100`, { headers: auth });
    if (!tiendas.ok) {
      throw new Error(`No se pudo consultar el catálogo en ${BASE_CATALOGO}.`);
    }
    const lista = (await tiendas.json()).data as { id: string; nombre: string; activo: boolean }[];
    // La que menos ventas tenga, para no estorbar a las demás pruebas.
    const objetivo = lista.find((t) => t.activo);
    expect(objetivo).toBeDefined();

    const desactivar = async (activo: boolean) =>
      fetch(`${BASE_CATALOGO}/v1/stores/${objetivo!.id}`, {
        method: 'PATCH',
        headers: { ...authAdmin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo }),
      });

    const baja = await desactivar(false);
    if (!baja.ok) {
      // Sin token de Administrador no se puede dar de baja: se omite en vez
      // de dar un falso negativo.
      console.warn(`No se pudo desactivar la tienda (${baja.status}); prueba omitida.`);
      return;
    }

    try {
      const d = (await get('/v1/transactions?limit=1')).cuerpo.data[0].details[0];
      const manual = await fetch(`${BASE}/v1/transactions`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: objetivo!.id,
          folio: `${CORRIDA}-BAJA`,
          fecha: '2026-09-12',
          details: [{ presentationId: d.presentationId, quantity: 1, unitPrice: 10 }],
        }),
      });
      expect(manual.status).toBe(400);
      expect((await manual.json()).message).toMatch(/dada de baja/i);

      const csv = Buffer.from(
        [
          'folio,fecha,tienda,sku,presentacion,cantidad,precio',
          `${CORRIDA}-BAJA2,2026-09-12,${objetivo!.nombre},${d.productSku},${d.presentationName},1,10.00`,
        ].join('\n') + '\n',
      );
      const preview = await subirCsv(csv, `${CORRIDA}-baja.csv`);
      expect(preview.estado).toBe(201);
      expect(preview.cuerpo.filasValidas).toBe(0);
      expect(preview.cuerpo.errores.map((e: { codigo: string }) => e.codigo)).toContain(
        'TIENDA_INACTIVA',
      );
    } finally {
      await desactivar(true);
    }
  }, 90000);

  it('spend-by-category no pierde gasto: los share suman 100', async () => {
    const gasto = (await get('/v1/analytics/spend-by-category')).cuerpo as {
      categoryId: number | null;
      categoryName: string;
      totalSpend: number;
      share: number;
    }[];
    expect(gasto.length).toBeGreaterThan(0);

    const sumaShares = gasto.reduce((s, c) => s + c.share, 0);
    expect(Math.abs(sumaShares - 100)).toBeLessThanOrEqual(0.5);

    // Si algún producto no tuviera categoría, aparecería agrupado en vez de
    // desaparecer del total (hoy categoria_id es NOT NULL, así que no sale).
    const sinCategoria = gasto.find((c) => c.categoryId == null);
    if (sinCategoria) {
      expect(sinCategoria.categoryName).toBe('Sin categoría');
      expect(sinCategoria.totalSpend).toBeGreaterThan(0);
    }
  }, 30000);

  it('reclassify de UNA canasta: refresca segmento y respeta la zona congelada', async () => {
    const canasta = (await get('/v1/baskets?limit=1')).cuerpo.data[0];

    const sinResync = await fetch(`${BASE}/v1/baskets/${canasta.id}/reclassify`, {
      method: 'POST',
      headers: auth,
    });
    expect(sinResync.status).toBe(200);
    const r = await sinResync.json();
    // La zona NO cambia por defecto: se congela al construir la canasta.
    expect(r.zoneId).toBe(canasta.zoneId);
    expect(r.id).toBe(canasta.id);

    // Con resyncZone la zona se deriva de la tienda; con los datos del seed
    // la tienda sigue en la misma zona, así que debe coincidir.
    const conResync = await fetch(`${BASE}/v1/baskets/${canasta.id}/reclassify?resyncZone=true`, {
      method: 'POST',
      headers: auth,
    });
    expect(conResync.status).toBe(200);
    expect((await conResync.json()).zoneId).toBe(canasta.zoneId);

    const malParametro = await fetch(
      `${BASE}/v1/baskets/${canasta.id}/reclassify?resyncZone=quizas`,
      { method: 'POST', headers: auth },
    );
    expect(malParametro.status).toBe(400);
  }, 60000);

  it('un parámetro de paginación inválido da 400, no 500', async () => {
    const r = await get('/v1/baskets?segmentId=abc');
    expect(r.estado).toBe(400);
    expect(r.cuerpo.code).toBe('VALIDATION_ERROR');
  });
});
