import { apiClient } from './client';

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
  apiClient.post<Recomendacion[]>('/recommendations/generate', { zoneId }).then((r) => r.data);

export const explicarRecomendacion = (id: string) =>
  apiClient.get<ExplicacionRecomendacion>(`/recommendations/${id}/explain`).then((r) => r.data);
