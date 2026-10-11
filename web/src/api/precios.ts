import { pricingApi, traerTodo } from './client';
import { PriceComparisonResult, PriceHistoryEntry } from '../types';

export interface RegistrarPrecioPayload {
  presentationId: string;
  storeId: string;
  price: number;
  /** ISO `yyyy-mm-dd`. Si se omite, el backend usa hoy. */
  effectiveDate?: string;
}

export const registrarPrecio = (payload: RegistrarPrecioPayload) =>
  pricingApi.post<PriceHistoryEntry>('/prices', payload).then((r) => r.data);

/** Histórico de un producto (todas sus presentaciones), o de una sola si se indica. */
export const getHistorialPrecios = (productId: string, presentationId?: string) =>
  traerTodo<PriceHistoryEntry>(pricingApi, '/prices/history', { productId, presentationId });

/** Compara el precio VIGENTE de un producto entre las zonas donde se vende. */
export const compararPreciosEntreZonas = (productId: string) =>
  pricingApi
    .get<PriceComparisonResult>('/prices/compare-zones', { params: { productId } })
    .then((r) => r.data);
