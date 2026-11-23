import { segmentationApi, traerTodo } from './client';
import { IncomeSegment } from '../types';

/**
 * Segmentos de ingreso. Desde el Sprint 4 viven en income-segmentation-service (D-35), no en
 * catalog-service: mismas rutas y campos, más `version`. Editar un segmento crea una versión
 * nueva y la anterior se conserva. Contrato: docs/contratos/income-segmentation-service.md
 */
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

/**
 * Edición: sin `code` (la API lo rechaza: identifica al segmento entre versiones). `null` en
 * `incomeRangeMax` quita el tope y en `description` la borra; omitirlos los deja como están.
 */
export type ActualizarSegmentoPayload = Partial<Omit<CrearSegmentoPayload, 'code' | 'incomeRangeMax' | 'description'>> & {
  incomeRangeMax?: number | null;
  description?: string | null;
  changeReason?: string;
};

export const getSegmentos = () =>
  traerTodo<IncomeSegment>(segmentationApi, '/segments');

export const getSegmento = (id: number) =>
  segmentationApi.get<IncomeSegment>(`/segments/${id}`).then((r) => r.data);

export const crearSegmento = (payload: CrearSegmentoPayload) =>
  segmentationApi.post<IncomeSegment>('/segments', payload).then((r) => r.data);

export const actualizarSegmento = (id: number, payload: ActualizarSegmentoPayload) =>
  segmentationApi.patch<IncomeSegment>(`/segments/${id}`, payload).then((r) => r.data);

export const eliminarSegmento = (id: number) =>
  segmentationApi.delete<void>(`/segments/${id}`).then((r) => r.data);
