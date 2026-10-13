import { auditApi } from './client';
import { AuditoriaFiltros, AuditoriaPagina } from '../types';

export const getBitacora = (filtros?: AuditoriaFiltros) =>
  auditApi.get<AuditoriaPagina>('/auditoria', { params: filtros }).then((r) => r.data);
