import { serializarXml } from '../common/interceptors/xml.interceptor';

/**
 * Ejemplos de Swagger (JSON y XML) con los datos del contrato §5, §8 y §9.
 * El XML sale del MISMO serializador del servicio, con el namespace del XSD.
 */
const NS = 'workflow/v1';

const asignado = {
  id: '6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e',
  recommendationId: '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b',
  status: 'asignada',
  assigneeUserId: '3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e',
  assignedBy: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
  assignedAt: '2026-10-30T17:00:00.000Z',
  dueDate: '2026-11-15',
  assignmentNote: 'Aplicar el ajuste de precio del arroz 1 kg en Zona Centro.',
  startedAt: null,
  implementedOn: null,
  implementedAt: null,
  implementationNote: null,
  evaluatedBy: null,
  evaluatedAt: null,
  evaluation: null,
};

const evaluado = {
  ...asignado,
  status: 'evaluada',
  startedAt: '2026-10-31T15:00:00.000Z',
  implementedOn: '2026-11-01',
  implementedAt: '2026-11-01T18:00:00.000Z',
  implementationNote: 'Precio del arroz 1 kg bajado de $27.50 a $25.00 en las tiendas de Zona Centro.',
  evaluatedBy: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d',
  evaluatedAt: '2026-12-01T16:00:00.000Z',
  evaluation: {
    metric: 'precio_unitario',
    unit: 'MXN/kg',
    scope: { zoneId: 'f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44', presentationId: '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e' },
    before: { from: '2026-10-02', to: '2026-10-31', value: 27.5 },
    after: { from: '2026-11-01', to: '2026-11-30', value: 25 },
    variationPct: -9.09,
    source: 'pricing-service GET /v1/prices/variation, presentación arroz 1 kg, Zona Centro',
    comment: 'El precio por kilo bajó como se recomendó.',
  },
};

const historial = {
  assignmentId: '6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e',
  data: [
    { event: 'asignada', toStatus: 'asignada', actorId: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d', at: '2026-10-30T17:00:00.000Z', correlationId: '0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f', audit: 'enviado', notification: 'enviado' },
    { event: 'iniciada', fromStatus: 'asignada', toStatus: 'en_implementacion', actorId: '3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e', at: '2026-10-31T15:00:00.000Z', correlationId: '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a', audit: 'enviado', notification: 'fallido' },
  ],
};

const ERRORES: Record<number, { message: string; code: string; details: string[] | null }> = {
  400: { message: 'Unidades incompatibles.', code: 'VALIDATION_ERROR', details: ['unit MXN no corresponde a la métrica precio_unitario (usa MXN/kg, MXN/l o MXN/pza)'] },
  401: { message: 'Sesión inactiva. Vuelve a iniciar sesión.', code: 'UNAUTHORIZED', details: null },
  403: { message: 'Solo el responsable asignado puede mover este seguimiento.', code: 'FORBIDDEN', details: null },
  404: { message: 'El seguimiento no existe.', code: 'NOT_FOUND', details: null },
  409: { message: 'Transición fuera de orden.', code: 'CONFLICT', details: ['estado actual: asignada', 'transición pedida: implementada', 'primero se inicia (start)'] },
  503: { message: 'decision-service no respondió en 3 s.', code: 'SERVICE_UNAVAILABLE', details: null },
};

export const EJEMPLOS = {
  asignacionJson: {
    recommendationId: '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b',
    assigneeUserId: '3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e',
    dueDate: '2026-11-15',
    note: 'Aplicar el ajuste de precio del arroz 1 kg en Zona Centro.',
  },
  asignacionXml: `<?xml version="1.0" encoding="UTF-8"?>
<asignacionRequest xmlns="workflow/v1">
  <recommendationId>9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b</recommendationId>
  <assigneeUserId>3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e</assigneeUserId>
  <dueDate>2026-11-15</dueDate>
  <note>Aplicar el ajuste de precio del arroz 1 kg en Zona Centro.</note>
</asignacionRequest>`,
  implementacionXml: `<?xml version="1.0" encoding="UTF-8"?>
<implementacionRequest xmlns="workflow/v1">
  <implementedOn>2026-11-01</implementedOn>
  <note>Precio del arroz 1 kg bajado de $27.50 a $25.00 en las tiendas de Zona Centro.</note>
</implementacionRequest>`,
  evaluacionXml: `<?xml version="1.0" encoding="UTF-8"?>
<evaluacionRequest xmlns="workflow/v1">
  <metric>precio_unitario</metric>
  <unit>MXN/kg</unit>
  <scope>
    <zoneId>f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44</zoneId>
    <presentationId>8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e</presentationId>
  </scope>
  <before><from>2026-10-02</from><to>2026-10-31</to><value>27.50</value></before>
  <after><from>2026-11-01</from><to>2026-11-30</to><value>25.00</value></after>
  <source>pricing-service GET /v1/prices/variation, presentación arroz 1 kg, Zona Centro</source>
  <comment>El precio por kilo bajó como se recomendó.</comment>
</evaluacionRequest>`,
  asignado,
  evaluado,
  lista: { data: [asignado], total: 1, page: 1, limit: 20 },
  historial,
  contenido(datos: unknown, raiz: string) {
    return {
      'application/json': { example: datos },
      'application/xml': { example: serializarXml(datos, { raiz, namespace: NS }) },
    };
  },
  error(status: number) {
    const e = ERRORES[status];
    const cuerpo = { statusCode: status, ...e, path: '/v1/workflow/assignments', timestamp: '2026-10-30T17:00:00.000Z' };
    return {
      'application/json': { example: cuerpo },
      'application/xml': { example: serializarXml(cuerpo, { raiz: 'error', namespace: NS }) },
    };
  },
};
