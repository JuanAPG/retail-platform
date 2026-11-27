import { pedir } from './httpClient';
import { asList, numberOrNull, text, textOrNull } from './xml';

/*
 * decision-service (3107). Contrato: docs/contratos/decision-service.md, XSD decision-service.xsd
 * (namespace decision/v1). Simular (M13) es SOLO del Planeador (D-31); los demás internos leen
 * los escenarios guardados. Los dos POST de simulación se mandan en XML (`Content-Type:
 * application/xml`), raíces `simulacionPrecioRequest` y `simulacionPresentacionRequest` del XSD
 * (contrato, "Cuerpo XML de entrada"). Las promociones están en promotionApi.ts (promotion-service).
 */

export interface ResultadoIndicador {
  indicatorKey: string;
  zoneId: string | null;
  baseValue: number | null;
  simulatedValue: number | null;
  variationPct: number | null;
}

export interface SimulacionPrecio {
  scenarioId: string;
  productId: string;
  presentationId: string;
  zoneId: string | null;
  currentPrice: number | null;
  newPrice: number | null;
  baseDemand: number | null;
  elasticity: number | null;
  elasticityRunId: string | null;
  results: ResultadoIndicador[];
  assumptions: string[];
  note: string | null;
}

export interface PresentacionEvaluada {
  presentationId: string;
  presentationName: string;
  baseUnit: string | null;
  priceStatus: string;
  outlay: number | null;
  unitPrice: number | null;
  estimatedDemand: number | null;
  incomeSharePct: number | null;
  unitPricePremiumPct: number | null;
}

export interface SimulacionEmpaque {
  scenarioId: string;
  productId: string;
  productName: string;
  zoneId: string | null;
  presentations: PresentacionEvaluada[];
  results: ResultadoIndicador[];
  assumptions: string[];
  warnings: string[];
}

export interface Escenario {
  id: string;
  name: string;
  type: string;
  zoneId: string | null;
  productId: string | null;
  presentationId: string | null;
  elasticity: number | null;
  currentPrice: number | null;
  newPrice: number | null;
  createdBy: string | null;
  createdAt: string | null;
}

function indicadores(nodo: any): ResultadoIndicador[] {
  return asList(nodo?.item).map((r: any) => ({
    indicatorKey: text(r.indicatorKey),
    zoneId: textOrNull(r.zoneId),
    baseValue: numberOrNull(r.baseValue),
    simulatedValue: numberOrNull(r.simulatedValue),
    // El XSD dice variationPct; el ejemplo JSON del contrato, variacionPct.
    variationPct: numberOrNull(r.variationPct ?? r.variacionPct),
  }));
}

/** <simulacionPrecioResponse> */
export function parseSimulacionPrecio(r: any): SimulacionPrecio {
  const i = r.inputs ?? {};
  return {
    scenarioId: text(r.scenarioId),
    productId: text(r.productId),
    presentationId: text(r.presentationId),
    zoneId: textOrNull(r.zoneId),
    currentPrice: numberOrNull(i.currentPrice),
    newPrice: numberOrNull(i.newPrice),
    baseDemand: numberOrNull(i.baseDemand),
    elasticity: numberOrNull(i.elasticity),
    elasticityRunId: textOrNull(i.elasticityRunId),
    results: indicadores(r.results),
    assumptions: asList(r.assumptions?.item).map(text),
    note: textOrNull(r.note),
  };
}

/** <simulacionPresentacionResponse> */
export function parseSimulacionEmpaque(r: any): SimulacionEmpaque {
  return {
    scenarioId: text(r.scenarioId),
    productId: text(r.productId),
    productName: text(r.productName),
    zoneId: textOrNull(r.zoneId),
    presentations: asList(r.presentations?.item).map((p: any) => ({
      presentationId: text(p.presentationId),
      presentationName: text(p.presentationName),
      baseUnit: textOrNull(p.baseUnit),
      priceStatus: text(p.priceStatus),
      outlay: numberOrNull(p.outlay),
      unitPrice: numberOrNull(p.unitPrice),
      estimatedDemand: numberOrNull(p.estimatedDemand),
      incomeSharePct: numberOrNull(p.accessibilityEffect?.incomeSharePct),
      unitPricePremiumPct: numberOrNull(p.accessibilityEffect?.unitPricePremiumPct),
    })),
    results: indicadores(r.results),
    assumptions: asList(r.assumptions?.item).map(text),
    warnings: asList(r.warnings?.item).map(text),
  };
}

/** <simulacionEscenariosResponse> (paginado según el XSD). */
export function parseEscenarios(r: any): { escenarios: Escenario[]; total: number } {
  return {
    escenarios: asList(r?.data?.item).map((e: any) => ({
      id: text(e.id),
      name: text(e.name),
      type: text(e.type),
      zoneId: textOrNull(e.zoneId),
      productId: textOrNull(e.productId),
      presentationId: textOrNull(e.presentationId),
      elasticity: numberOrNull(e.elasticity),
      currentPrice: numberOrNull(e.currentPrice),
      newPrice: numberOrNull(e.newPrice),
      createdBy: textOrNull(e.createdBy),
      createdAt: textOrNull(e.createdAt),
    })),
    total: Number(r?.total ?? 0),
  };
}

/** Cuerpo de <simulacionPrecioRequest> en el orden del XSD (xs:sequence): presentationId, zoneId, newPrice. */
export function cuerpoSimulacionPrecio(c: { presentationId: string; zoneId: string; newPrice: number }): Record<string, unknown> {
  return { presentationId: c.presentationId, zoneId: c.zoneId, newPrice: c.newPrice.toFixed(2) };
}

/**
 * Cuerpo de <simulacionPresentacionRequest> (xs:all): productId y, si vienen, zoneId y
 * presentationIds como lista de <item>.
 */
export function cuerpoSimulacionEmpaque(c: { productId: string; zoneId?: string; presentationIds?: string[] }): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = { productId: c.productId };
  if (c.zoneId) cuerpo.zoneId = c.zoneId;
  if (c.presentationIds && c.presentationIds.length > 0) cuerpo.presentationIds = c.presentationIds;
  return cuerpo;
}

/** POST /v1/simulation/price (Planeador), cuerpo XML: un descuento o cambio de precio con la elasticidad vigente. */
export async function simularPrecio(cuerpo: { presentationId: string; zoneId: string; newPrice: number }): Promise<SimulacionPrecio> {
  return parseSimulacionPrecio(
    await pedir({
      servicio: 'decision',
      metodo: 'POST',
      ruta: 'v1/simulation/price',
      xml: { raiz: 'simulacionPrecioRequest', datos: cuerpoSimulacionPrecio(cuerpo) },
      raiz: 'simulacionPrecioResponse',
    }),
  );
}

/** POST /v1/simulation/presentation (Planeador): compara empaques de un producto (mínimo 3, D-14). */
export async function simularEmpaque(cuerpo: {
  productId: string;
  zoneId?: string;
  presentationIds?: string[];
}): Promise<SimulacionEmpaque> {
  return parseSimulacionEmpaque(
    await pedir({
      servicio: 'decision',
      metodo: 'POST',
      ruta: 'v1/simulation/presentation',
      xml: { raiz: 'simulacionPresentacionRequest', datos: cuerpoSimulacionEmpaque(cuerpo) },
      raiz: 'simulacionPresentacionResponse',
    }),
  );
}

/** GET /v1/simulation/scenarios: escenarios guardados (lectura de los perfiles internos). */
export async function listarEscenarios(page = 1, limit = 50): Promise<{ escenarios: Escenario[]; total: number }> {
  return parseEscenarios(
    await pedir({ servicio: 'decision', ruta: 'v1/simulation/scenarios', params: { page, limit }, raiz: 'simulacionEscenariosResponse' }),
  );
}

/** Lo que dice una recomendación (qué, por qué, impacto), para el detalle de su seguimiento. */
export interface RecomendacionResumen {
  recommendationId: string;
  title: string;
  whatRecommends: string;
  why: string;
  estimatedImpact: string;
  status: string;
}

/** <recomendacion> (xs:all). */
export function parseRecomendacion(r: any): RecomendacionResumen {
  return {
    recommendationId: text(r?.recommendationId),
    title: text(r?.title),
    whatRecommends: text(r?.whatRecommends),
    why: text(r?.why),
    estimatedImpact: text(r?.estimatedImpact),
    status: text(r?.status),
  };
}

/** GET /v1/recommendations/:id/explain (lectura de los perfiles internos). */
export async function explicarRecomendacion(id: string): Promise<RecomendacionResumen> {
  return parseRecomendacion(await pedir({ servicio: 'decision', ruta: `v1/recommendations/${id}/explain`, raiz: 'recomendacion' }));
}
