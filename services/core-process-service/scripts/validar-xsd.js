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
  ['transaction', 'POST /v1/transactions y GET /v1/transactions/:id', muestras.transaccion],
  ['transactions-page', 'GET /v1/transactions', pagina([muestras.transaccion], 100)],
  ['transactions-page', 'GET /v1/transactions sin resultados', pagina([], 0)],
  ['basket', 'GET /v1/baskets/:id', muestras.canasta],
  ['basket', 'GET /v1/baskets/:id con segmento nulo', { ...muestras.canasta, segmentId: null }],
  ['baskets-page', 'GET /v1/baskets', pagina([muestras.canasta], 100)],
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
