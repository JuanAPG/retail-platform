import { serializarXml } from '../common/interceptors/xml.interceptor';

/**
 * Ejemplos de Swagger (JSON y XML), con los datos del contrato §6, §9, §11 y
 * §12. El XML sale del MISMO serializador que usa el servicio, con el
 * namespace del XSD, para que lo documentado sea lo que se responde.
 * (`test/` valida cada uno contra el XSD oficial.)
 */
const NS = 'promotion/v1';

const promocion = {
  id: '3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7',
  name: 'Arroz 1 kg con 10 % en Zona Centro',
  type: 'descuento_porcentual',
  productId: '1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  presentationId: '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e',
  storeId: null,
  zoneId: 'f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44',
  discountPct: 10,
  packQuantity: null,
  packPrice: null,
  promoContent: null,
  promoUnit: null,
  promoPrice: null,
  currency: 'MXN',
  validFrom: '2026-11-01',
  validTo: '2026-11-15',
  status: 'pendiente',
  validity: 'programada',
  proposedBy: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
  proposedAt: '2026-10-29T17:20:00.000Z',
  resolvedBy: null,
  resolvedAt: null,
  rejectionReason: null,
};

const aprobada = {
  ...promocion,
  status: 'aprobada',
  resolvedBy: '3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e',
  resolvedAt: '2026-10-30T16:05:00.000Z',
};

const { validity: _sinVigencia, ...sinValidity } = promocion;
const rechazada = {
  ...sinValidity,
  status: 'rechazada',
  resolvedBy: '3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e',
  resolvedAt: '2026-10-30T16:05:00.000Z',
  rejectionReason: 'El descuento se encima con la campaña de regreso a clases.',
};

const precioUnitario = {
  promotionId: '4f6a8b02-3c5d-4e7f-9a21-b3c4d5e6f708',
  type: 'paquete',
  status: 'aprobada',
  productId: '1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  presentationId: '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e',
  storeId: '27f05c81-c6bf-456a-a273-150e4edb9900',
  baseUnit: 'kg',
  currency: 'MXN',
  disponible: true,
  motivo: null,
  regular: { disponible: true, price: 30, effectiveDate: '2026-10-01', contentBase: 1, unitPrice: 30, motivo: null },
  promotional: { purchasePrice: 80, items: 3, contentBase: 3, unitPrice: 26.67 },
  savingsPct: 11.11,
};

const comparacion = {
  productId: '1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  storeId: '27f05c81-c6bf-456a-a273-150e4edb9900',
  baseUnit: 'kg',
  currency: 'MXN',
  data: [
    { promotionId: '5a7b9c13-4d6e-4f80-8b32-c4d5e6f70819', type: 'tamano_empaque', presentationId: '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e', status: 'aprobada', disponible: true, unitPrice: 25, regularUnitPrice: 30, savingsPct: 16.67 },
    { promotionId: '4f6a8b02-3c5d-4e7f-9a21-b3c4d5e6f708', type: 'paquete', presentationId: '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e', status: 'aprobada', disponible: true, unitPrice: 26.67, regularUnitPrice: 30, savingsPct: 11.11 },
    { promotionId: '3e5f7a91-2b4c-4d6e-8f10-a2b3c4d5e6f7', type: 'descuento_porcentual', presentationId: '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e', status: 'aprobada', disponible: true, unitPrice: 27, regularUnitPrice: 30, savingsPct: 10 },
  ],
};

const MENSAJES: Record<number, { message: string; code: string; details?: string[] }> = {
  400: { message: 'Unidades incompatibles.', code: 'VALIDATION_ERROR', details: ['promoUnit: ml (volumen) no se compara con la presentación en kg (masa)'] },
  401: { message: 'Sesión inactiva. Vuelve a iniciar sesión.', code: 'UNAUTHORIZED' },
  403: { message: 'Solo el Responsable de precios aprueba promociones.', code: 'FORBIDDEN' },
  404: { message: 'La promoción no existe.', code: 'NOT_FOUND' },
  409: { message: 'La promoción ya está aprobada; no se resuelve dos veces.', code: 'CONFLICT' },
  503: { message: 'catalog-service no respondió en 3 s.', code: 'SERVICE_UNAVAILABLE' },
};

function cuerpoError(status: number) {
  const m = MENSAJES[status];
  return {
    statusCode: status,
    message: m.message,
    code: m.code,
    details: m.details ?? null,
    path: '/v1/promotions',
    timestamp: '2026-10-30T16:06:00.000Z',
  };
}

export const EJEMPLOS = {
  peticionJson: {
    name: 'Arroz 1 kg con 10 % en Zona Centro',
    type: 'descuento_porcentual',
    productId: '1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
    presentationId: '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e',
    zoneId: 'f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44',
    discountPct: 10,
    validFrom: '2026-11-01',
    validTo: '2026-11-15',
  },
  peticionXml: `<?xml version="1.0" encoding="UTF-8"?>
<promocionRequest xmlns="promotion/v1">
  <name>Arroz 1 kg: 3 por $80</name>
  <type>paquete</type>
  <productId>1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f</productId>
  <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
  <storeId>27f05c81-c6bf-456a-a273-150e4edb9900</storeId>
  <packQuantity>3</packQuantity>
  <packPrice>80.00</packPrice>
  <validFrom>2026-11-01</validFrom>
  <validTo>2026-11-15</validTo>
</promocionRequest>`,
  rechazoXml: `<?xml version="1.0" encoding="UTF-8"?>
<rechazoPromocionRequest xmlns="promotion/v1">
  <reason>El descuento se encima con la campaña de regreso a clases.</reason>
</rechazoPromocionRequest>`,
  promocion,
  aprobada,
  rechazada,
  lista: { data: [promocion], total: 1, page: 1, limit: 20 },
  precioUnitario,
  comparacion,
  cuerpoError,
  contenido(datos: unknown, raiz: string) {
    return {
      'application/json': { example: datos },
      'application/xml': { example: serializarXml(datos, { raiz, namespace: NS }) },
    };
  },
  error(status: number) {
    const cuerpo = cuerpoError(status);
    return {
      'application/json': { example: cuerpo },
      'application/xml': { example: serializarXml(cuerpo, { raiz: 'error', namespace: NS }) },
    };
  },
};
