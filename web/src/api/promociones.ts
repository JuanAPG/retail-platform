import { promotionApi } from './client';

/** promotion-service (3115, D-39). Contrato: docs/contratos/promotion-service.md */
export type TipoPromocion = 'descuento_porcentual' | 'paquete' | 'tamano_empaque';
export type EstadoPromocion = 'pendiente' | 'aprobada' | 'rechazada';

export interface Promocion {
  id: string;
  name: string;
  type: TipoPromocion;
  productId: string;
  presentationId: string;
  storeId: string | null;
  zoneId: string | null;
  discountPct: number | null;
  packQuantity: number | null;
  packPrice: number | null;
  promoContent: number | null;
  promoUnit: string | null;
  promoPrice: number | null;
  currency: string;
  validFrom: string;
  validTo: string;
  status: EstadoPromocion;
  /** Vigencia calculada por el servicio (p. ej. programada, vigente, vencida). */
  validity: string;
  proposedBy: string;
  proposedAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  rejectionReason: string | null;
}

/** Cuerpo de POST /v1/promotions: exactamente uno de storeId/zoneId y solo los campos de su tipo (§4). */
export interface PropuestaPromocion {
  name: string;
  type: TipoPromocion;
  productId: string;
  presentationId: string;
  storeId?: string;
  zoneId?: string;
  discountPct?: number;
  packQuantity?: number;
  packPrice?: number;
  promoContent?: number;
  promoUnit?: string;
  promoPrice?: number;
  validFrom: string;
  validTo: string;
}

export const proponerPromocion = (p: PropuestaPromocion) =>
  promotionApi.post<Promocion>('/promotions', p).then((r) => r.data);

export const getPromociones = (params: { page?: number; limit?: number; status?: EstadoPromocion } = {}) =>
  promotionApi
    .get<{ data: Promocion[]; total: number; page: number; limit: number }>('/promotions', { params: { limit: 50, ...params } })
    .then((r) => r.data);
