import { pricingApi } from './client';

export type EstatusObservacion = 'pendiente' | 'aprobado' | 'rechazado';

/** Precio levantado en tienda (app móvil). No cambia el precio vigente hasta que el Responsable de precios lo aprueba. */
export interface ObservacionPrecio {
  id: string;
  presentationId: string;
  storeId: string;
  price: string;
  observedAt: string;
  lat: number | null;
  lng: number | null;
  status: EstatusObservacion;
  origin: string;
  rejectionReason: string | null;
  capturedBy: string;
  createdAt: string;
  presentation?: { id: string; nombre: string; producto?: { sku: string; nombre: string } };
  store?: { id: string; nombre: string; zonaId?: string };
}

export interface PaginaObservaciones {
  data: ObservacionPrecio[];
  total: number;
  page: number;
  limit: number;
}

export const getObservacionesPrecio = (params: { status?: EstatusObservacion; page?: number; limit?: number } = {}) =>
  pricingApi.get<PaginaObservaciones>('/price-observations', { params }).then((r) => r.data);

export const aprobarObservacionPrecio = (id: string, effectiveDate?: string) =>
  pricingApi.patch(`/price-observations/${id}/approve`, effectiveDate ? { effectiveDate } : {}).then((r) => r.data);

export const rechazarObservacionPrecio = (id: string, rejectionReason: string) =>
  pricingApi.patch(`/price-observations/${id}/reject`, { rejectionReason }).then((r) => r.data);
