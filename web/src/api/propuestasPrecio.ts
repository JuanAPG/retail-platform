import { pricingApi } from './client';

export type EstatusPropuesta = 'pendiente' | 'aprobado' | 'rechazado';

export interface PropuestaPrecio {
  id: string;
  presentationId: string;
  supplierId: string;
  proposedPrice: string;
  purchaseUnit: string | null;
  status: EstatusPropuesta;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  presentation?: {
    id: string;
    nombre: string;
    producto?: { sku: string; nombre: string };
  };
}

export interface PaginaPropuestas {
  data: PropuestaPrecio[];
  total: number;
  page: number;
  limit: number;
}

export const getPropuestasPrecio = (params: { status?: EstatusPropuesta; page?: number; limit?: number } = {}) =>
  pricingApi.get<PaginaPropuestas>('/price-proposals', { params }).then((r) => r.data);

export const proponerPrecio = (payload: { presentationId: string; proposedPrice: number; purchaseUnit?: string }) =>
  pricingApi.post<PropuestaPrecio>('/price-proposals', payload).then((r) => r.data);

export const aprobarPropuestaPrecio = (id: string, payload: { storeIds: string[]; effectiveDate?: string }) =>
  pricingApi.patch(`/price-proposals/${id}/approve`, payload).then((r) => r.data);

export const rechazarPropuestaPrecio = (id: string, rejectionReason: string) =>
  pricingApi.patch(`/price-proposals/${id}/reject`, { rejectionReason }).then((r) => r.data);
