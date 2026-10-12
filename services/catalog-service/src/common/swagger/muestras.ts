/**
 * Datos de ejemplo para la documentación Swagger. Reflejan la forma real de
 * cada respuesta (ver docs/contratos/catalog-service.md); los valores son
 * ilustrativos.
 */

const FECHA = '2026-09-25T19:21:10.262Z';

const municipio = { id: 2, nombre: 'Monterrey' };

const segmento = {
  id: 1,
  code: 'ING_1',
  name: 'Ingreso bajo',
  incomeRangeMin: '0.00',
  incomeRangeMax: '15000.00',
  source: 'INEGI - ENIGH, ingreso corriente trimestral por hogar (AMM)',
  updateFrequency: 'Anual, al publicarse la ENIGH',
  zoneRelation: 'Se asigna a la ZONA agregada (RN-02); nunca a una persona ni compra individual.',
  limitations: 'No captura variación de ingreso dentro de la misma zona.',
  description: null,
};

const zona = {
  id: 'f2670df2-94bd-494e-b4ac-04f7e7c02476',
  nombre: 'Zona Centro',
  municipioId: 2,
  descripcion: 'Centro histórico y comercio tradicional.',
  activo: true,
  createdAt: FECHA,
  updatedAt: FECHA,
  municipio,
};

const comparacionZona = {
  zoneId: 'f2670df2-94bd-494e-b4ac-04f7e7c02476',
  zoneName: 'Zona Centro',
  municipality: 'Monterrey',
  classification: 'Ingreso medio',
  estimatedIncome: null,
  population: null,
  availability: null,
};

const indicadoresZona = {
  zoneId: 'f2670df2-94bd-494e-b4ac-04f7e7c02476',
  estimatedIncome: 18500,
  population: 42000,
  availability: 0.85,
  periodStart: '2026-01-01',
  periodEnd: '2026-09-30',
  source: 'INEGI - Censo 2020',
  runId: '3f1c2b8e-5b1d-4a56-9c3e-7a1b2c3d4e5f',
};

const clasificacionZona = {
  zoneId: 'f2670df2-94bd-494e-b4ac-04f7e7c02476',
  segmentId: 2,
  segmentCode: 'ING_2',
  segmentName: 'Ingreso medio',
  since: '2026-10-08',
  previousSegmentId: 1,
};

const codigoPostal = { codigoPostal: '64000', municipioId: 2, municipio };

const tienda = {
  id: '27f05c81-c6bf-456a-a273-150e4edb9900',
  nombre: 'Abarrotes Constitución',
  direccionId: '65abaa34-29cc-4df7-b0a1-db31650d2c8e',
  zonaId: zona.id,
  proveedorId: null,
  formato: 'minimarket',
  numeroSucursal: 'SUC-002',
  activo: true,
  createdAt: FECHA,
  updatedAt: FECHA,
  direccion: {
    id: '65abaa34-29cc-4df7-b0a1-db31650d2c8e',
    calle: 'Av. Constitución',
    numeroExterior: '1050',
    numeroInterior: null,
    colonia: 'Centro',
    codigoPostal: '64000',
    referencia: null,
    latitud: null,
    longitud: null,
    codigoPostalRef: codigoPostal,
  },
  zona,
  proveedor: null,
};

const proveedor = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  razonSocial: 'Lácteos del Norte S.A.',
  rfc: 'LDN200101AB1',
  contactoNombre: 'Elena Ruiz',
  email: 'ventas@lacteosdelnorte.mx',
  telefono: '81 1234 5678',
  activo: true,
  createdAt: FECHA,
  updatedAt: FECHA,
};

const unidad = { id: 1, clave: 'kg', nombre: 'Kilogramo', tipo: 'masa', factorBase: '1.000000' };

const categoria = { id: 1, nombre: 'Abarrotes', categoriaPadreId: null, descripcion: null };

const presentacion = {
  id: 'b7d2e0aa-1111-4222-8333-444455556666',
  productoId: 'c9a1f0bb-7777-4888-9999-aaaabbbbcccc',
  nombre: '1 kg',
  contenido: '1.000',
  unidadMedidaId: 1,
  codigoBarras: null,
  esPredeterminada: true,
  activo: true,
  createdAt: FECHA,
  updatedAt: FECHA,
  unidadMedida: unidad,
};

const producto = {
  id: 'c9a1f0bb-7777-4888-9999-aaaabbbbcccc',
  sku: 'ABA-ARR-001',
  nombre: 'Arroz blanco 1 kg',
  descripcion: null,
  categoriaId: 1,
  esCanastaBasica: true,
  estatus: 'activo',
  proveedorId: null,
  createdAt: FECHA,
  updatedAt: FECHA,
  categoria,
  proveedor: null,
  presentaciones: [presentacion],
};

const productoPendiente = {
  ...producto,
  sku: 'LDN-QUE-400',
  nombre: 'Queso fresco 400 g',
  esCanastaBasica: false,
  estatus: 'pendiente_aprobacion',
  proveedorId: proveedor.id,
  proveedor,
};

export const muestras = {
  municipio,
  segmento,
  zona,
  comparacionZona,
  indicadoresZona,
  clasificacionZona,
  codigoPostal,
  tienda,
  proveedor,
  unidad,
  categoria,
  presentacion,
  producto,
  productoPendiente,
};
