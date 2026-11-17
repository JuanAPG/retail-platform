/**
 * Ejemplos de respuesta para Swagger. Son los mismos del contrato
 * (`docs/contratos/income-segmentation-service.md`) y con los campos en el
 * orden del XSD, porque de aquí sale también el ejemplo XML.
 */
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
  version: 2,
  versionValidFrom: '2026-10-30T16:00:00.000Z',
};

const version = {
  segmentId: 1,
  version: 1,
  name: 'Ingreso bajo',
  incomeRangeMin: '0.00',
  incomeRangeMax: '12000.00',
  source: 'INEGI - ENIGH 2022',
  updateFrequency: 'Anual, al publicarse la ENIGH',
  zoneRelation: 'Se asigna a la ZONA agregada (RN-02).',
  limitations: 'No captura variación de ingreso dentro de la misma zona.',
  description: null,
  validFrom: '2026-09-25T19:21:10.262Z',
  validTo: '2026-10-30T16:00:00.000Z',
  current: false,
  createdBy: '0b9d6c1e-3f1a-4a52-8a3e-1d2c3b4a5f60',
  changeReason: null,
};

const clasificacion = {
  id: '4c1f6a1e-52a7-4f0b-9a0e-6f1b2c3d4e5f',
  zoneId: '97925ca4-3845-4e68-9660-46f781957b8c',
  segmentId: 3,
  segmentCode: 'ING_3',
  segmentName: 'Ingreso alto',
  segmentVersion: 1,
  segmentCurrentVersion: 2,
  origin: 'manual',
  validFrom: '2026-09-25',
  validTo: null,
  current: true,
  assignedBy: '0b9d6c1e-3f1a-4a52-8a3e-1d2c3b4a5f60',
};

const publicacion = {
  minTransactions: 10,
  minStores: 3,
  rule: 'ambos',
  data: [
    {
      zoneId: '97925ca4-3845-4e68-9660-46f781957b8c',
      segmentId: 3,
      segmentCode: 'ING_3',
      segmentVersion: 1,
      transactions: 42,
      stores: 3,
      disponible: true,
      motivo: null,
      averageTicket: 86.4,
    },
    {
      zoneId: 'f2670df2-94bd-494e-b4ac-04f7e7c02476',
      segmentId: 2,
      segmentCode: 'ING_2',
      segmentVersion: 2,
      transactions: 9,
      stores: 2,
      disponible: false,
      motivo: 'Menos de 10 transacciones y menos de 3 tiendas en la combinación zona-segmento (D-36).',
      averageTicket: null,
    },
  ],
};

export const muestras = { segmento, version, clasificacion, publicacion };
