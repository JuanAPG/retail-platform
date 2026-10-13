import { decisionApi, traerTodo } from './client';

/** M14 — Una recomendación ya generada y guardada. */
export interface Recomendacion {
  id: string;
  corridaId: string | null;
  escenarioId: string | null;
  zonaId: string | null;
  titulo: string;
  queRecomienda: string;
  porQue: string;
  impactoEstimado: string;
  estatus: 'propuesta' | 'aceptada' | 'descartada';
  generadaEn: string;
}

export interface EvidenciaRecomendacion {
  dimension: string;
  referenceId: string;
  description: string;
}

/** M14 — Respuesta de GET /recommendations/:id/explain. */
export interface ExplicacionRecomendacion {
  recommendationId: string;
  title: string;
  whatRecommends: string;
  why: string;
  estimatedImpact: string;
  evidence: EvidenciaRecomendacion[];
  status: string;
  generatedAt: string;
}

/** Evalúa las 4 reglas (accesibilidad, elasticidad, simulación, asociación) y guarda lo que encuentre. */
export const generarRecomendaciones = (zoneId?: string) =>
  decisionApi.post<Recomendacion[]>('/recommendations/generate', { zoneId }).then((r) => r.data);

export const explicarRecomendacion = (id: string) =>
  decisionApi.get<ExplicacionRecomendacion>(`/recommendations/${id}/explain`).then((r) => r.data);

/** Elemento de GET /recommendations (nombres en inglés, sin evidencia). */
interface ResumenRecomendacion {
  id: string;
  title: string;
  whatRecommends: string;
  why: string;
  estimatedImpact: string;
  zoneId: string | null;
  scenarioId: string | null;
  runId: string | null;
  status: Recomendacion['estatus'];
  generatedAt: string;
}

/** Lista las recomendaciones guardadas (recientes primero), para que sobrevivan a una recarga. */
export const listarRecomendaciones = (filtros: { zoneId?: string; status?: Recomendacion['estatus'] } = {}) =>
  traerTodo<ResumenRecomendacion>(decisionApi, '/recommendations', {
    ...(filtros.zoneId ? { zoneId: filtros.zoneId } : {}),
    ...(filtros.status ? { status: filtros.status } : {}),
  }).then((filas): Recomendacion[] =>
    filas.map((r) => ({
      id: r.id,
      corridaId: r.runId,
      escenarioId: r.scenarioId,
      zonaId: r.zoneId,
      titulo: r.title,
      queRecomienda: r.whatRecommends,
      porQue: r.why,
      impactoEstimado: r.estimatedImpact,
      estatus: r.status,
      generadaEn: r.generatedAt,
    })),
  );

/** D-12: solo el Gerente de categoría decide. Una recomendación ya decidida responde 409. */
export const aprobarRecomendacion = (id: string) =>
  decisionApi.patch<ExplicacionRecomendacion>(`/recommendations/${id}/approve`).then((r) => r.data);

/** El motivo es obligatorio (10 a 500 caracteres) y queda en la bitácora. */
export const rechazarRecomendacion = (id: string, motivo: string) =>
  decisionApi.patch<ExplicacionRecomendacion>(`/recommendations/${id}/reject`, { motivo }).then((r) => r.data);
