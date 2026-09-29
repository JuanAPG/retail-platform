import { apiClient } from './client';
import { AuditoriaFiltros, AuditoriaPagina } from '../types';

export const getBitacora = (filtros?: AuditoriaFiltros) =>
  apiClient.get<AuditoriaPagina>('/auditoria', { params: filtros }).then((r) => r.data);
