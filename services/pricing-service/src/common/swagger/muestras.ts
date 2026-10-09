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
      presentationId: '0b1f6c1e-3a52-4d0b-9a55-2f4e6a1d7c10',
      presentationName: '1 L',
      averagePrice: 41.25,
      minPrice: 39.9,
      maxPrice: 42.5,
      storeCount: 2,
    },
  ],
  perUnit: [
    {
      zoneId: 'f2670df2-94bd-494e-b4ac-04f7e7c02476',
      zoneName: 'Zona Centro',
      baseUnit: 'l',
      averagePricePerBaseUnit: 41.25,
      minPricePerBaseUnit: 39.9,
      maxPricePerBaseUnit: 42.5,
      storeCount: 2,
    },
  ],
};

const observacion = {
  id: '2c1f6e0a-7b3d-4e8a-9a41-5d0c1b2a3f4e',
  presentationId: 'a3475b93-07c0-4c38-997a-5a13563abec9',
  storeId: '866487b8-0830-4dae-a50b-4eaeb6780a11',
  price: '27.50',
  observedAt: '2026-10-08T15:30:00.000Z',
  lat: 25.6866,
  lng: -100.3161,
  status: 'pendiente',
  origin: 'observado_en_campo',
  rejectionReason: null,
  capturedBy: 'a8e46052-34a0-4dda-baf2-40bca267454f',
  reviewedBy: null,
  reviewedAt: null,
  priceId: null,
  createdAt: '2026-10-08T15:31:00.000Z',
  presentation: { id: 'a3475b93-07c0-4c38-997a-5a13563abec9', productoId: 'c9a1f0bb-7777-4888-9999-aaaabbbbcccc', nombre: '1 L', producto: { sku: 'LDN-LEC', nombre: 'Leche entera' } },
  store: { id: '866487b8-0830-4dae-a50b-4eaeb6780a11', nombre: 'Super Valle Centro', zonaId: 'f2670df2-94bd-494e-b4ac-04f7e7c02476' },
};

const alertaConfig = {
  umbralPct: 5,
  ventanaDias: 30,
  updatedBy: 'a8e46052-34a0-4dda-baf2-40bca267454f',
  updatedAt: '2026-10-08T18:00:00.000Z',
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
  alertaConfig,
  observacion,
  propuesta,
  propuestaAprobada,
  propuestaRechazada,
  aprobacion,
};
