import { apiClient } from './client';
import { Zona } from '../types';

/** M07 — Filtros opcionales de GET /baskets. */
export interface CanastaFiltros {
  storeId?: string;
  zoneId?: string;
  segmentId?: number;
  /** ISO `yyyy-mm-dd`. */
  dateFrom?: string;
  /** ISO `yyyy-mm-dd`, inclusivo. */
  dateTo?: string;
}

/**
 * M07 — Una canasta: se construye sola al guardar una transacción (RN-03,
 * una transacción = una canasta), nunca se crea a mano.
 */
export interface Canasta {
  id: string;
  transactionId: string;
  zoneId: string;
  zone: Zona;
  segmentId: number | null;
  date: string;
  /** Numérico como texto (Postgres numeric vía TypeORM). */
  totalValue: string;
  productCount: number;
  /** Numérico como texto. */
  unitsTotal: string;
  basicProductsCount: number;
  builtAt: string;
}

export const getCanastas = (filtros?: CanastaFiltros) =>
  apiClient.get<Canasta[]>('/baskets', { params: filtros }).then((r) => r.data);
