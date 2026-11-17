/**
 * Ejemplos de respuesta para Swagger. Son los del contrato
 * (`docs/contratos/availability-service.md`), con los campos en el orden del
 * XSD, porque de aquí sale también el ejemplo XML.
 */
const TIENDA = '27f05c81-c6bf-456a-a273-150e4edb9900';
const ZONA = 'f2670df2-94bd-494e-b4ac-04f7e7c02476';
const PRESENTACION = '5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77';
const PRODUCTO = '8e2b7c44-0a8f-4d6b-9c1d-3f5a7b9c1e22';

const capturaBase = {
  captureId: 'c0a8012e-7d7c-4b5e-9a51-0d6f3f2a9b11',
  status: 'aceptada',
  storeId: TIENDA,
  presentationId: PRESENTACION,
  stock: 12,
  capturedAt: '2026-10-26T15:30:00.000Z',
  receivedAt: '2026-10-30T09:02:11.000Z',
  origin: 'movil',
  capturedBy: '0b9d6c1e-3f1a-4a52-8a3e-1d2c3b4a5f60',
};

/** Respuesta del POST: trae además la existencia que quedó en el servidor. */
const captura = {
  ...capturaBase,
  currentStock: 12,
  currentCapturedAt: '2026-10-26T15:30:00.000Z',
  reason: null,
};

/** Fila de la bitácora. */
const capturaListada = { ...capturaBase, reason: null };

const existencia = {
  storeId: TIENDA,
  presentationId: PRESENTACION,
  stock: 12,
  capturedAt: '2026-10-26T15:30:00.000Z',
  ageDays: 3,
  status: 'disponible',
};

const coberturaTienda = {
  storeId: TIENDA,
  validDays: 7,
  basics: 4,
  covered: 2,
  missing: 1,
  expired: 1,
  noData: 0,
  disponible: true,
  coverage: 50,
  motivo: null,
  items: [
    {
      productId: PRODUCTO,
      productName: 'Frijol negro',
      status: 'cubierto',
      presentationsWithStock: 1,
      lastCapturedAt: '2026-10-28T10:00:00.000Z',
    },
  ],
};

const coberturaZona = {
  zoneId: ZONA,
  validDays: 7,
  stores: 2,
  basics: 4,
  covered: 3,
  disponible: true,
  coverage: 75,
  motivo: null,
  items: [{ productId: PRODUCTO, productName: 'Frijol negro', status: 'cubierto', storesWithStock: 1, storeShare: 50 }],
  byStore: [{ storeId: TIENDA, disponible: true, coverage: 50, covered: 2, missing: 1 }],
};

const faltantes = {
  storeId: TIENDA,
  validDays: 7,
  data: [
    {
      productId: PRODUCTO,
      productName: 'Leche entera',
      storeId: TIENDA,
      lastCapturedAt: '2026-10-29T12:00:00.000Z',
    },
  ],
};

export const muestras = { captura, capturaListada, existencia, coberturaTienda, coberturaZona, faltantes };
