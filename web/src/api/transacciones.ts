import { apiClient } from './client';
import { CsvImportResult, CsvPreview, Transaction } from '../types';

export interface CrearTransaccionLinea {
  presentationId: string;
  quantity: number;
  unitPrice: number;
}

export interface CrearTransaccionPayload {
  storeId: string;
  folio: string;
  /** ISO `yyyy-mm-dd`. */
  date: string;
  details: CrearTransaccionLinea[];
}

export const getTransacciones = (filtros?: { storeId?: string; dateFrom?: string; dateTo?: string }) =>
  apiClient.get<Transaction[]>('/transactions', { params: filtros }).then((r) => r.data);

export const getTransaccion = (id: string) =>
  apiClient.get<Transaction>(`/transactions/${id}`).then((r) => r.data);

export const crearTransaccion = (payload: CrearTransaccionPayload) =>
  apiClient.post<Transaction>('/transactions', payload).then((r) => r.data);

/** Sube el CSV y devuelve el preview validado (nada se inserta todavía). */
export const previsualizarCsv = (archivo: File) => {
  const forma = new FormData();
  forma.append('file', archivo);
  return apiClient.post<CsvPreview>('/transactions/import/preview', forma).then((r) => r.data);
};

/** Inserta las filas válidas del preview y construye sus canastas. */
export const confirmarCsv = (previewId: string) =>
  apiClient.post<CsvImportResult>('/transactions/import/confirm', { previewId }).then((r) => r.data);
