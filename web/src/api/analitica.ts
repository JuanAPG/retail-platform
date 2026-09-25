import { apiClient } from './client';
import { AnalyticsFilters, CategorySpend } from '../types';

/**
 * M09 — Indicadores descriptivos. Rutas en inglés según el Contrato de
 * Métodos y Endpoints.
 */

/**
 * Quita los filtros vacíos. Un select sin elegir llega como '' y el
 * backend rechaza `?zoneId=` con 400 (valida UUID y no admite extras).
 */
function limpiarFiltros(filtros: AnalyticsFilters = {}): AnalyticsFilters {
  return Object.fromEntries(
    Object.entries(filtros).filter(([, valor]) => valor !== undefined && valor !== null && valor !== ''),
  );
}

const getIndicador = (ruta: string, filtros?: AnalyticsFilters) =>
  apiClient.get<number>(`/analytics/${ruta}`, { params: limpiarFiltros(filtros) }).then((r) => r.data);

export const getTicketPromedio = (filtros?: AnalyticsFilters) => getIndicador('average-ticket', filtros);

export const getProductosPorCanasta = (filtros?: AnalyticsFilters) =>
  getIndicador('products-per-basket', filtros);

export const getFrecuenciaCompra = (filtros?: AnalyticsFilters) => getIndicador('purchase-frequency', filtros);

export const getUnidadesPorTransaccion = (filtros?: AnalyticsFilters) =>
  getIndicador('units-per-transaction', filtros);

export const getGastoPorCategoria = (filtros?: AnalyticsFilters) =>
  apiClient
    .get<CategorySpend[]>('/analytics/spend-by-category', { params: limpiarFiltros(filtros) })
    .then((r) => r.data);

export interface ResumenIndicadores {
  ticketPromedio: number;
  productosPorCanasta: number;
  frecuenciaCompra: number;
  unidadesPorTransaccion: number;
  gastoPorCategoria: CategorySpend[];
}

/** Los cinco indicadores en paralelo, con los mismos filtros. */
export const getResumenIndicadores = async (filtros?: AnalyticsFilters): Promise<ResumenIndicadores> => {
  const [ticketPromedio, productosPorCanasta, frecuenciaCompra, unidadesPorTransaccion, gastoPorCategoria] =
    await Promise.all([
      getTicketPromedio(filtros),
      getProductosPorCanasta(filtros),
      getFrecuenciaCompra(filtros),
      getUnidadesPorTransaccion(filtros),
      getGastoPorCategoria(filtros),
    ]);
  return { ticketPromedio, productosPorCanasta, frecuenciaCompra, unidadesPorTransaccion, gastoPorCategoria };
};
