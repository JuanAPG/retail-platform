import { coreApi, traerTodo } from './client';
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
  fecha: string;
  details: CrearTransaccionLinea[];
}

export const getTransacciones = (filtros?: { storeId?: string; dateFrom?: string; dateTo?: string }) =>
  traerTodo<Transaction>(coreApi, '/transactions', { ...filtros });

export const getTransaccion = (id: string) =>
  coreApi.get<Transaction>(`/transactions/${id}`).then((r) => r.data);

export const crearTransaccion = (payload: CrearTransaccionPayload) =>
  coreApi.post<Transaction>('/transactions', payload).then((r) => r.data);

/** Sube el CSV y devuelve el preview validado (nada se inserta todavía). */
export const previsualizarCsv = (archivo: File) => {
  const forma = new FormData();
  forma.append('file', archivo);
  return coreApi.post<CsvPreview>('/transactions/import/preview', forma).then((r) => r.data);
};

/** Inserta las filas válidas del preview y construye sus canastas. */
export const confirmarCsv = (previewId: string) =>
  coreApi.post<CsvImportResult>('/transactions/import/confirm', { previewId }).then((r) => r.data);

/** M06 — Una importación ya validada (preview) que nadie confirmó todavía. */
export interface ImportacionPendiente {
  importacionId: string;
  fileName: string;
  estado: string;
  filasTotales: number;
  filasValidas: number;
  filasConError: number;
  cargadoEn: string;
}

/** Para retomar una importación validada sin volver a subir el archivo. */
export const getImportacionesPendientes = () =>
  coreApi.get<ImportacionPendiente[]>('/transactions/import/pending').then((r) => r.data);
