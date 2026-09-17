import { apiClient } from './client';
import { IncomeSegment } from '../types';

/** M05 — nombres de campo en inglés: así quedaron en el Contrato del backend. */
export interface CrearSegmentoPayload {
  code: string;
  name: string;
  incomeRangeMin: number;
  incomeRangeMax?: number;
  source: string;
  updateFrequency: string;
  zoneRelation: string;
  limitations: string;
  description?: string;
}

export type ActualizarSegmentoPayload = Partial<CrearSegmentoPayload>;

export const getSegmentos = () =>
  apiClient.get<IncomeSegment[]>('/segments').then((r) => r.data);

export const getSegmento = (id: number) =>
  apiClient.get<IncomeSegment>(`/segments/${id}`).then((r) => r.data);

export const crearSegmento = (payload: CrearSegmentoPayload) =>
  apiClient.post<IncomeSegment>('/segments', payload).then((r) => r.data);

export const actualizarSegmento = (id: number, payload: ActualizarSegmentoPayload) =>
  apiClient.patch<IncomeSegment>(`/segments/${id}`, payload).then((r) => r.data);

export const eliminarSegmento = (id: number) =>
  apiClient.delete<void>(`/segments/${id}`).then((r) => r.data);
