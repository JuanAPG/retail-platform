import { pricingApi } from './client';

export interface ConfigAlertaPrecio {
  umbralPct: number;
  ventanaDias: number;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export const getAlertaPrecio = () => pricingApi.get<ConfigAlertaPrecio>('/prices/alert-settings').then((r) => r.data);

export const guardarAlertaPrecio = (payload: { umbralPct: number; ventanaDias: number }) =>
  pricingApi.put<ConfigAlertaPrecio>('/prices/alert-settings', payload).then((r) => r.data);
