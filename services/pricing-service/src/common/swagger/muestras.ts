/**
 * Datos de ejemplo para la documentación Swagger. Reflejan la forma real de
 * cada respuesta (ver docs/contratos/pricing-service.md); los valores son
 * ilustrativos.
 */

const precio = {
  id: '7f0c2a10-5b1e-4c3a-9d2e-1a2b3c4d5e6f',
  presentationId: 'b7d2e0aa-1111-4222-8333-444455556666',
  storeId: '27f05c81-c6bf-456a-a273-150e4edb9900',
  price: '42.50',
  effectiveDate: '2026-09-14',
  effectiveUntil: null,
  vigente: true,
  origen: 'interno',
  createdBy: 'e1d2c3b4-0000-4000-8000-00000000abcd',
  createdAt: '2026-09-14T15:00:00.000Z',
  presentation: {
    id: 'b7d2e0aa-1111-4222-8333-444455556666',
    productoId: 'c9a1f0bb-7777-4888-9999-aaaabbbbcccc',
    nombre: '1 kg',
    contenido: '1.000',
    unidadMedida: 'kg',
  },
  store: {
    id: '27f05c81-c6bf-456a-a273-150e4edb9900',
    nombre: 'Abarrotes Constitución',
    zonaId: 'f2670df2-94bd-494e-b4ac-04f7e7c02476',
    zona: { id: 'f2670df2-94bd-494e-b4ac-04f7e7c02476', nombre: 'Zona Centro' },
  },
};

const precioCerrado = {
  ...precio,
  id: '1a2b3c4d-0000-4000-8000-000000000002',
  price: '40.00',
  effectiveDate: '2026-08-01',
  effectiveUntil: '2026-09-13',
  vigente: false,
};

const comparacion = {
  productId: 'c9a1f0bb-7777-4888-9999-aaaabbbbcccc',
  zones: [
    {
      zoneId: 'f2670df2-94bd-494e-b4ac-04f7e7c02476',
      zoneName: 'Zona Centro',
      averagePrice: 41.25,
      minPrice: 39.9,
      maxPrice: 42.5,
      storeCount: 2,
    },
  ],
};

const propuesta = {
  id: '5e6f7a8b-0000-4000-8000-0000000000aa',
  presentationId: 'b7d2e0aa-1111-4222-8333-444455556666',
  supplierId: 'a1b2c3d4-0000-4000-8000-000000000001',
  proposedPrice: '38.00',
  purchaseUnit: 'caja 12 pzas',
  status: 'pendiente',
  rejectionReason: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-09-30T15:00:00.000Z',
  presentation: {
    id: 'b7d2e0aa-1111-4222-8333-444455556666',
    productoId: 'c9a1f0bb-7777-4888-9999-aaaabbbbcccc',
    nombre: '400 g',
    contenido: '400.000',
    unidadMedida: 'g',
    producto: { sku: 'LDN-QUE-400', nombre: 'Queso fresco 400 g' },
  },
  supplier: { id: 'a1b2c3d4-0000-4000-8000-000000000001', razonSocial: 'Lácteos del Norte S.A.' },
};

const propuestaAprobada = {
  ...propuesta,
  status: 'aprobado',
  reviewedBy: 'e1d2c3b4-0000-4000-8000-00000000abcd',
  reviewedAt: '2026-10-01T10:00:00.000Z',
};

const propuestaRechazada = {
  ...propuesta,
  status: 'rechazado',
  rejectionReason: 'El precio propuesto excede el límite de variación de la zona.',
  reviewedBy: 'e1d2c3b4-0000-4000-8000-00000000abcd',
  reviewedAt: '2026-10-01T10:00:00.000Z',
};

const aprobacion = {
  proposal: propuestaAprobada,
  prices: [{ ...precio, price: '38.00', origen: 'propuesta_proveedor_aprobada' }],
};

export const muestras = {
  precio,
  precioCerrado,
  comparacion,
  propuesta,
  propuestaAprobada,
  propuestaRechazada,
  aprobacion,
};
