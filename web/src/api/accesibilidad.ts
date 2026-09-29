import { apiClient } from './client';

/** M12 — Índice de accesibilidad de una zona (GET /accessibility/index y /accessibility/by-zone/:zoneId). */
export interface IndiceAccesibilidad {
  zoneId: string;
  segmentId: number;
  basicBasketCost: number;
  estimatedIncome: number | null;
  indexValue: number;
  calculatedAt?: string;
}

/** Calcula el índice AHORA MISMO: crea un análisis nuevo cada vez, no pisa el anterior. */
export const calcularAccesibilidad = (zoneId: string, segmentId: string) =>
  apiClient.get<IndiceAccesibilidad>('/accessibility/index', { params: { zoneId, segmentId } }).then((r) => r.data);

export const getHistorialAccesibilidad = (zoneId: string) =>
  apiClient.get<IndiceAccesibilidad[]>(`/accessibility/by-zone/${zoneId}`).then((r) => r.data);
