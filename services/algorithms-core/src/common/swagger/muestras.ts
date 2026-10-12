/**
 * Datos de ejemplo para la documentación Swagger. Reflejan la forma real de
 * cada respuesta (ver docs/contratos/algorithms-core.md); los valores son
 * ilustrativos. `date` va en texto ISO, como lo entrega el servicio.
 */

const FECHA = '2026-10-06T02:18:46.951Z';
const CORRIDA_ID = '70ec7386-6725-47f6-a1fd-278ffc65630c';
const USUARIO = { id: 'c7377a43-e543-473a-a100-95192ba4777a', nombre: 'Carlos Ruiz Torres' };
const QUESO = { id: '11238c8b-e282-40e2-bd32-95a93a226b15', sku: 'LDN-QUE-400', nombre: 'Queso panela', categoriaId: 2 };
const LECHE = { id: '11ca87b1-5972-4a74-9275-1afa5b8b9cfe', sku: 'LDN-LEC', nombre: 'Leche entera', categoriaId: 2 };

function regla(id: string, antecedente: typeof QUESO, consecuente: typeof QUESO, confidence: number) {
  return {
    id,
    runId: CORRIDA_ID,
    support: 0.33333,
    confidence,
    lift: 1.5,
    transactionCount: 2,
    items: [
      { ruleId: id, productId: antecedente.id, side: 'antecedente', product: antecedente },
      { ruleId: id, productId: consecuente.id, side: 'consecuente', product: consecuente },
    ],
  };
}

const reglaQuesoLeche = regla('4e8f1c2a-9b7d-4c3e-8a1f-6d2b5e9c0a17', QUESO, LECHE, 1);
const reglaLecheQueso = regla('9a3d7e51-2c84-4b6f-a0d9-1e5f8c3b7a42', LECHE, QUESO, 0.5);

const parametros = [
  ['algoritmo', 'apriori'],
  ['confianza_minima', '0.5'],
  ['reglas_excluidas_rn10', '0'],
  ['reglas_generadas', '2'],
  ['soporte_minimo', '0.2'],
  ['tamano_maximo_itemset', '3'],
].map(([key, value]) => ({ runId: CORRIDA_ID, key, value }));

/** Corrida tal como sale en el listado (sin supuestos, filtros ni reglas). */
const corrida = {
  id: CORRIDA_ID,
  type: 'asociacion',
  status: 'completada',
  userId: USUARIO.id,
  periodStart: '2026-08-05',
  periodEnd: '2026-08-15',
  transactionsConsidered: 6,
  basketsConsidered: 6,
  errorMessage: null,
  parameters: parametros,
  date: FECHA,
  user: USUARIO,
};

/** Corrida completa: lo necesario para reproducirla y explicarla. */
const corridaCompleta = {
  ...corrida,
  assumptions: [
    'Una canasta equivale a una transacción (RN-03).',
    'Las presentaciones se agrupan en su producto y la cantidad comprada no pondera: cuenta presencia o ausencia.',
    'Se aplicaron las exclusiones de categorías vigentes (RN-10): 0 regla(s) descartada(s).',
  ].map((assumption, n) => ({ runId: CORRIDA_ID, order: n + 1, assumption })),
  filters: [],
  results: [reglaQuesoLeche, reglaLecheQueso],
};

// ===== Elasticidad (M11): valores de una corrida por día sobre el CSV de 100 canastas.

const CORRIDA_ELASTICIDAD = '99e12a2b-6f3d-4c8a-9b21-5e7d0c4a8f13';
const FECHA_ELASTICIDAD = '2026-10-10T20:10:16.569Z';
const ZONA_ORIENTE = { id: 'b3c1e7a2-4d5f-4a8b-9c0d-1e2f3a4b5c6d', nombre: 'Zona Oriente' };
const LECHE_1L = { id: '7d2e9f41-3a6b-4c8d-8e1f-2a3b4c5d6e7f', product: 'Leche entera', presentation: '1 L' };
const FRIJOL_1KG = { id: '5a8c3e72-9b1d-4f6a-8c2e-3d4f5a6b7c8d', product: 'Frijol negro', presentation: '1 kg' };

function elasticidad(p: typeof LECHE_1L, zona: typeof ZONA_ORIENTE | null, value: number, rSquared: number, observations: number) {
  return {
    presentationId: p.id,
    productName: p.product,
    presentationName: p.presentation,
    zoneId: zona?.id ?? null,
    zoneName: zona?.nombre ?? 'Nacional',
    value,
    classification: 'elastic',
    rSquared,
    observations,
  };
}

const frijolOriente = elasticidad(FRIJOL_1KG, ZONA_ORIENTE, -12.5959, 0.95082, 28);
const frijolNacional = elasticidad(FRIJOL_1KG, null, -1.8771, 0.06995, 55);
// E > 0 con estos datos: el precio de la leche solo cambia entre zonas, no en el tiempo.
const lecheNacional = elasticidad(LECHE_1L, null, 3.4397, 0.07999, 60);

/** Respuesta de POST /v1/elasticity/calculate. */
const calculoElasticidad = {
  runId: CORRIDA_ELASTICIDAD,
  periodStart: '2026-08-02',
  periodEnd: '2026-09-20',
  granularity: 'day',
  results: [frijolOriente, frijolNacional, lecheNacional].map((r) => ({ ...r, atypical: r.value > 0 })),
  insufficient: [
    {
      presentationId: '9e4b2d61-7c3a-4f8e-a1b2-c3d4e5f6a7b8',
      productName: 'Quinoa orgánica',
      presentationName: '500 g',
      zoneId: null,
      zoneName: 'Nacional',
      observations: 11,
      distinctPrices: 1,
      reason: 'Un solo precio en el periodo: no se puede medir cómo reacciona la demanda al precio.',
    },
  ],
  assumptions: [
    'Modelo de elasticidad constante: cantidad = A · precio^E; E es la pendiente de ln(cantidad) contra ln(precio).',
    'Cada observación es una zona × día: precio promedio realmente cobrado (ponderado por unidades) y unidades vendidas.',
    'Una elasticidad positiva (la demanda sube con el precio) se marca como atípica.',
  ],
};

/** Respuesta de GET /v1/elasticity/chart (por zona): toda zona sale como barra, con o sin valor. */
const graficoElasticidad = {
  runId: CORRIDA_ELASTICIDAD,
  presentationId: FRIJOL_1KG.id,
  productName: FRIJOL_1KG.product,
  presentationName: FRIJOL_1KG.presentation,
  groupBy: 'zone',
  executedAt: FECHA_ELASTICIDAD,
  granularity: 'day',
  periodStart: '2026-08-02',
  periodEnd: '2026-09-20',
  bars: [
    {
      key: 'f2670df2-94bd-494e-b4ac-04f7e7c02476',
      label: 'Zona Centro',
      value: null,
      classification: null,
      observations: 0,
      rSquared: null,
      atypical: null,
    },
    {
      key: ZONA_ORIENTE.id,
      label: ZONA_ORIENTE.nombre,
      value: -12.5959,
      classification: 'elastic',
      observations: 28,
      rSquared: 0.95082,
      atypical: false,
    },
  ],
  national: { value: -1.8771, classification: 'elastic', observations: 55, rSquared: 0.06995, atypical: false },
  note: 'Elasticidad de cada zona (análisis del 2026-10-10, observaciones por día). Barras vacías: sin datos suficientes.',
};

/** Fila de GET /v1/elasticity/current. */
const vigente = (e: ReturnType<typeof elasticidad>) => ({
  ...e,
  atypical: e.value > 0,
  outdated: false,
  runId: CORRIDA_ELASTICIDAD,
  executedAt: FECHA_ELASTICIDAD,
  periodStart: '2026-08-02',
  periodEnd: '2026-09-20',
});

// ===== Sustitución (M11): salida real del CSV de 100 canastas, categoría Abarrotes.

/** Respuesta de GET /v1/substitution/patterns?categoryId=1. */
const patronesSustitucion = [
  {
    originProductId: '2de8e032-49d5-4e16-a9b4-138e425ee91c',
    originProductName: 'Frijol negro',
    targetProductId: '4393bde8-2d1e-4534-a9d7-792d0b0b6cee',
    targetProductName: 'Quinoa orgánica',
    type: 'precio',
    score: 0.6302,
    lift: 0.1058,
    priceCorrelation: 0.3663,
    observations: 71,
    priceVariation: 0.1806,
    originFrequencyChange: -0.2439,
    targetFrequencyChange: 0.2683,
    summary:
      'Indicio de sustitución por precio: cuando Frijol negro estuvo más caro, más canastas llevaron Quinoa orgánica (r = 0.37). ' +
      'No prueba que una cosa cause la otra.',
    periodStart: '2026-08-02',
    periodEnd: '2026-09-20',
  },
];

export const muestras = {
  reglas: [reglaQuesoLeche, reglaLecheQueso],
  corrida,
  corridaCompleta,
  calculoElasticidad,
  graficoElasticidad,
  /** Zona primero y la nacional al final de cada presentación. */
  patronesSustitucion,
  elasticidadesVigentes: [vigente(frijolOriente), vigente(frijolNacional)],
};
