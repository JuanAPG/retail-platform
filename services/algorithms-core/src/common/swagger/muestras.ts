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

export const muestras = {
  reglas: [reglaQuesoLeche, reglaLecheQueso],
  corrida,
  corridaCompleta,
};
