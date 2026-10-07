#!/usr/bin/env node
/**
 * Valida que el XML que REALMENTE emite el servicio pase contra los XSD del
 * contrato (`docs/contratos/xsd/core-process/`).
 *
 * Serializa los ejemplos de Swagger con el mismo `serializarXml` del
 * `XmlInterceptor` —el que usan las respuestas de verdad— y corre
 * `xmllint --schema` sobre cada uno. Así un cambio en la forma de una
 * respuesta rompe aquí, no en la demo con la app de escritorio.
 *
 *   npm run build && npm run xsd
 *
 * Requiere `xmllint` (viene en macOS; en Debian/Ubuntu:
 * `sudo apt-get install -y libxml2-utils`).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const XSD = path.resolve(RAIZ, '..', '..', 'docs', 'contratos', 'xsd', 'core-process');
const DIST = path.join(RAIZ, 'dist');

if (!fs.existsSync(path.join(DIST, 'common', 'interceptors', 'xml.interceptor.js'))) {
  console.error('Falta dist/: corre `npm run build` antes de `npm run xsd`.');
  process.exit(1);
}

const { serializarXml } = require(path.join(DIST, 'common', 'interceptors', 'xml.interceptor.js'));
const { muestras } = require(path.join(DIST, 'common', 'swagger', 'muestras.js'));
const { aTransaccionRespuesta, aCanastaRespuesta } = require(
  path.join(DIST, 'common', 'respuestas.js'),
);

/**
 * ENTIDADES como las devuelve TypeORM, con sus relaciones `eager` cargadas
 * y todas las columnas de las tablas de catálogo.
 *
 * Esto es lo que importa validar: antes el script solo probaba los
 * ejemplos de Swagger escritos a mano, así que daba 21/21 mientras la
 * respuesta viva NO validaba (el serializador emitía `store`,
 * `zone.municipioId`, `activo`, `updatedAt`… que ningún XSD declaraba).
 * Pasar la entidad por el mapeador reproduce la salida real del endpoint.
 */
const zonaEntidad = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  nombre: 'Centro',
  municipioId: 7,
  descripcion: 'Zona centro',
  activo: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
  municipio: { id: 7, nombre: 'Monterrey', estado: 'Nuevo León' },
};

const tiendaEntidad = {
  id: '22222222-2222-4222-8222-222222222222',
  nombre: 'Super Valle Centro',
  zonaId: zonaEntidad.id,
  zona: zonaEntidad,
  activo: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
  direccion: {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    calle: 'Morelos 100',
    codigoPostal: { codigo: '64000', municipio: { id: 7, nombre: 'Monterrey' } },
  },
  proveedor: { id: 'pppppppp-pppp-4ppp-8ppp-pppppppppppp', nombre: 'Lácteos del Norte' },
};

const transaccionEntidad = {
  id: '11111111-1111-4111-8111-111111111111',
  folio: 'T-V-001',
  storeId: tiendaEntidad.id,
  store: tiendaEntidad,
  fecha: new Date('2026-09-02T10:15:00Z'),
  total: '142.50',
  canal: 'punto_venta',
  importacionId: null,
  capturadaPor: '55555555-5555-4555-8555-555555555555',
  createdAt: new Date('2026-09-02T10:16:03Z'),
  details: [
    {
      id: '66666666-6666-4666-8666-666666666666',
      transactionId: '11111111-1111-4111-8111-111111111111',
      presentationId: '77777777-7777-4777-8777-777777777777',
      quantity: '2.00',
      unitPrice: '42.50',
      subtotal: '85.00',
      presentation: {
        id: '77777777-7777-4777-8777-777777777777',
        nombre: '1 kg',
        productoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        activo: true,
        producto: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          sku: 'P-001-001',
          nombre: 'Leche entera',
          esCanastaBasica: true,
          estatus: 'activo',
          categoriaId: 2,
        },
      },
    },
    {
      id: '88888888-8888-4888-8888-888888888888',
      transactionId: '11111111-1111-4111-8111-111111111111',
      presentationId: '99999999-9999-4999-8999-999999999999',
      quantity: '1.00',
      unitPrice: '57.50',
      subtotal: '57.50',
      presentation: {
        id: '99999999-9999-4999-8999-999999999999',
        nombre: '500 g',
        productoId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        activo: true,
        producto: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', sku: 'P-002-001', nombre: 'Pan' },
      },
    },
  ],
};

const canastaEntidad = {
  id: '44444444-4444-4444-8444-444444444444',
  transactionId: transaccionEntidad.id,
  transaction: transaccionEntidad,
  zoneId: zonaEntidad.id,
  zone: zonaEntidad,
  segmentId: 2,
  date: new Date('2026-09-02T10:15:00Z'),
  totalValue: '142.50',
  productCount: 2,
  unitsTotal: '3.00',
  basicProductsCount: 1,
  builtAt: new Date('2026-09-02T10:16:03Z'),
};

const transaccionReal = aTransaccionRespuesta(transaccionEntidad);
const canastaReal = aCanastaRespuesta(canastaEntidad);
const canastaSinSegmento = aCanastaRespuesta({ ...canastaEntidad, segmentId: null });
// Canasta leída sin su transacción unida: `storeId` queda nulo.
const canastaSinTienda = aCanastaRespuesta({ ...canastaEntidad, transaction: undefined });

const pagina = (data, total) => ({ data, total, page: 1, limit: 20 });
const error = (statusCode, code, details = null) => ({
  statusCode,
  message: 'Mensaje de ejemplo.',
  code,
  details,
  path: '/v1/…',
  timestamp: '2026-10-06T12:00:00.000Z',
});

/** Cada caso: [xsd, descripción, cuerpo que devolvería el controlador]. */
const CASOS = [
  // Salida REAL del mapeador sobre entidades con relaciones eager.
  ['transaction', 'POST /v1/transactions (entidad real mapeada)', transaccionReal],
  ['transactions-page', 'GET /v1/transactions (entidad real mapeada)', pagina([transaccionReal], 100)],
  ['basket', 'GET /v1/baskets/:id (entidad real mapeada)', canastaReal],
  ['basket', 'GET /v1/baskets/:id con segmento nulo', canastaSinSegmento],
  ['basket', 'GET /v1/baskets/:id sin transacción unida', canastaSinTienda],
  ['baskets-page', 'GET /v1/baskets (entidad real mapeada)', pagina([canastaReal], 100)],
  // Y los ejemplos de Swagger, para que no se desincronicen del contrato.
  ['transaction', 'ejemplo Swagger de transacción', muestras.transaccion],
  ['basket', 'ejemplo Swagger de canasta', muestras.canasta],
  ['transactions-page', 'GET /v1/transactions sin resultados', pagina([], 0)],
  ['baskets-page', 'GET /v1/baskets sin resultados', pagina([], 0)],
  ['csv-preview', 'POST /v1/transactions/import/preview', muestras.previewCsv],
  ['csv-confirm', 'POST /v1/transactions/import/confirm', muestras.confirmCsv],
  [
    'csv-confirm',
    'confirm con folios omitidos y filas rechazadas',
    {
      ...muestras.confirmCsv,
      filasValidas: 3,
      filasConError: 3,
      lineasInsertadas: 3,
      transaccionesCreadas: 2,
      canastasCreadas: 2,
      transaccionesTotales: 2,
      filasPendientes: 0,
      completa: true,
      omitidos: [
        {
          folio: 'T-9',
          tienda: 'Super Valle Centro',
          tiendaId: '22222222-2222-4222-8222-222222222222',
          motivo: 'FOLIO_DUPLICADO: ya existe una transacción con este folio en la tienda.',
        },
      ],
      errores: [
        {
          fila: 5,
          columna: 'sku',
          codigo: 'SKU_NO_EXISTE',
          mensaje: 'No existe el producto con SKU "P-X".',
          valorRecibido: 'P-X',
        },
      ],
    },
  ],
  [
    'csv-confirm',
    'confirmación parcial reanudable (quedaron filas pendientes)',
    {
      ...muestras.confirmCsv,
      estado: 'validado',
      lineasInsertadas: 1,
      transaccionesCreadas: 1,
      canastasCreadas: 1,
      transaccionesTotales: 1,
      filasPendientes: 99,
      completa: false,
    },
  ],
  ['csv-discard', 'DELETE /v1/transactions/import/:id', muestras.importacionDescartada],
  ['reclassify', 'POST /v1/baskets/reclassify', muestras.reclasificacion],
  [
    'reclassify',
    'reclassify con zonas todavía sin clasificar',
    { canastasSinSegmento: 5, canastasClasificadas: 0, zonasSinClasificacion: ['z1', 'z2'] },
  ],
  ['imports-pending', 'GET /v1/transactions/import/pending', [muestras.importacionPendiente]],
  ['imports-pending', 'pending vacío', []],
  ['indicador-escalar', 'GET /v1/analytics/average-ticket', muestras.ticketPromedio],
  ['indicador-escalar', 'indicador sin canastas', 0],
  ['spend-by-category', 'GET /v1/analytics/spend-by-category', muestras.gastoPorCategoria],
  ['spend-by-category', 'gasto por categoría vacío', []],
  ['error', 'error 404', error(404, 'NOT_FOUND')],
  ['error', 'error 400 con details', error(400, 'VALIDATION_ERROR', ['storeId debe ser un UUID válido.'])],
  ['error', 'error 503', error(503, 'SERVICE_UNAVAILABLE')],
  [
    'health',
    'GET /v1/health',
    {
      status: 'ok',
      service: 'core-process-service',
      version: '1.0.0',
      checks: { postgres: 'ok', redis: 'ok' },
      timestamp: '2026-10-06T12:00:00.000Z',
    },
  ],
  [
    'health',
    'GET /v1/health degradado',
    {
      status: 'degraded',
      service: 'core-process-service',
      version: '1.0.0',
      checks: { postgres: 'error: connect ECONNREFUSED', redis: 'ok' },
      timestamp: '2026-10-06T12:00:00.000Z',
    },
  ],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xsd-core-process-'));
let fallos = 0;

for (const [esquema, descripcion, cuerpo] of CASOS) {
  const archivo = path.join(tmp, `${esquema}-${fallos}-${Math.random().toString(36).slice(2)}.xml`);
  fs.writeFileSync(archivo, serializarXml(cuerpo));
  try {
    execFileSync('xmllint', ['--noout', '--schema', path.join(XSD, `${esquema}.xsd`), archivo], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    console.log(`  ok    ${esquema.padEnd(20)} ${descripcion}`);
  } catch (e) {
    fallos++;
    console.error(`  FALLA ${esquema.padEnd(20)} ${descripcion}`);
    console.error(String(e.stderr ?? e.message).trim().split('\n').slice(0, 4).join('\n'));
    console.error(fs.readFileSync(archivo, 'utf-8'));
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${CASOS.length - fallos}/${CASOS.length} respuestas validan contra su XSD.`);
process.exit(fallos === 0 ? 0 : 1);
