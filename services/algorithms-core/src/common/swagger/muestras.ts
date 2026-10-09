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
const FECHA_ELASTICIDAD = '2026-10-08T21:58:12.402Z';
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
const frijolNacional = elasticidad(FRIJOL_1KG, null, -2.5558, 0.064, 40);
const lecheNacional = elasticidad(LECHE_1L, null, -4.0319, 0.023, 28);

/** Respuesta de POST /v1/elasticity/calculate. */
const calculoElasticidad = {
  runId: CORRIDA_ELASTICIDAD,
  periodStart: '2026-08-02',
  periodEnd: '2026-09-20',
  granularity: 'day',
  results: [frijolOriente, frijolNacional, lecheNacional].map((r) => ({ ...r, atypical: false })),
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
    { key: 'f2670df2-94bd-494e-b4ac-04f7e7c02476', label: 'Zona Centro', value: null, classification: null, observations: 0, rSquared: null },
    { key: ZONA_ORIENTE.id, label: ZONA_ORIENTE.nombre, value: -12.5959, classification: 'elastic', observations: 28, rSquared: 0.95082 },
  ],
  national: { value: -2.5558, classification: 'elastic', observations: 40, rSquared: 0.064 },
  note: 'Elasticidad de cada zona (análisis del 08/10/2026, observaciones por día). Barras vacías: sin datos suficientes.',
};

/** Fila de GET /v1/elasticity/current. */
const vigente = (e: ReturnType<typeof elasticidad>) => ({ ...e, runId: CORRIDA_ELASTICIDAD, executedAt: FECHA_ELASTICIDAD });

export const muestras = {
  reglas: [reglaQuesoLeche, reglaLecheQueso],
  corrida,
  corridaCompleta,
  calculoElasticidad,
  graficoElasticidad,
  /** Zona primero y la nacional al final de cada presentación. */
  elasticidadesVigentes: [vigente(frijolOriente), vigente(frijolNacional)],
};
