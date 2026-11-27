import { pedir } from './httpClient';
import {
  ElasticidadCalculo,
  ElasticidadGrafica,
  ElasticidadVigente,
  Rule,
  RunDetail,
  RunPage,
  parseElasticityCalculate,
  parseElasticityChart,
  parseElasticityCurrent,
  parseRunDetail,
  parseRunPage,
  parseRules,
} from './algorithmsParsers';

/*
 * algorithms-core (3105). Contrato: docs/contratos/algorithms-core.md, XSD algorithms-core.xsd
 * (namespace algorithms/v1). El servicio NO lee XML de entrada (lo dice su contrato, "Pendiente
 * · Transversal"): los cuerpos van en JSON; las respuestas, en XML.
 */

export type Algoritmo = 'apriori' | 'fpgrowth';

export interface AsociacionParams {
  minSupport: number;
  minConfidence: number;
  maxItemsetSize?: number;
  zoneId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Solo los campos con valor: el servicio rechaza campos de más y no acepta nulos. */
function sinVacios<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Partial<T>;
}

/** POST /v1/association/{apriori|fpgrowth}/run. Mismo cuerpo y misma respuesta; cambia la raíz XML. */
export async function runAsociacion(algoritmo: Algoritmo, params: AsociacionParams): Promise<Rule[]> {
  return parseRules(
    await pedir({
      servicio: 'algorithms',
      metodo: 'POST',
      ruta: `v1/association/${algoritmo}/run`,
      json: sinVacios(params),
      raiz: algoritmo === 'apriori' ? 'aprioriRunResponse' : 'fpgrowthRunResponse',
    }),
  );
}

export async function listRuns(page = 1, limit = 20): Promise<RunPage> {
  return parseRunPage(
    await pedir({ servicio: 'algorithms', ruta: 'v1/association/runs', params: { page, limit }, raiz: 'runListResponse' }),
  );
}

export async function getRun(id: string): Promise<RunDetail> {
  return parseRunDetail(await pedir({ servicio: 'algorithms', ruta: `v1/association/runs/${id}`, raiz: 'runResponse' }));
}

export interface ElasticidadParams {
  presentationId?: string;
  dateFrom?: string;
  dateTo?: string;
  granularity?: 'day' | 'week' | 'month';
}

/** POST /v1/elasticity/calculate: SOLO Responsable de precios (cualquier otro rol → 403). */
export async function calcularElasticidad(params: ElasticidadParams): Promise<ElasticidadCalculo> {
  return parseElasticityCalculate(
    await pedir({
      servicio: 'algorithms',
      metodo: 'POST',
      ruta: 'v1/elasticity/calculate',
      json: sinVacios(params),
      raiz: 'elasticityCalculateResponse',
    }),
  );
}

/** GET /v1/elasticity/chart: comparación por zona o segmento de una presentación. */
export async function graficaElasticidad(
  presentationId: string,
  groupBy: 'zone' | 'segment' = 'zone',
  runId?: string,
): Promise<ElasticidadGrafica> {
  return parseElasticityChart(
    await pedir({
      servicio: 'algorithms',
      ruta: 'v1/elasticity/chart',
      params: sinVacios({ presentationId, groupBy, runId }),
      raiz: 'elasticityChartResponse',
    }),
  );
}

/** GET /v1/elasticity/current: elasticidad vigente (corridas de ventana completa, D-22). */
export async function elasticidadVigente(filtros: { presentationId?: string; zoneId?: string } = {}): Promise<ElasticidadVigente[]> {
  const all: ElasticidadVigente[] = [];
  for (let page = 1; ; page += 1) {
    const { filas, total } = parseElasticityCurrent(
      await pedir({
        servicio: 'algorithms',
        ruta: 'v1/elasticity/current',
        params: { ...sinVacios(filtros), page, limit: 100 },
        raiz: 'currentElasticityListResponse',
      }),
    );
    all.push(...filas);
    if (all.length >= total || filas.length === 0) return all;
  }
}
