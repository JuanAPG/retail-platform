import { Badge } from '../../components/Badge';
import { AnalysisRunStatus } from '../../types';

/** M10 — Formatos compartidos por el historial y el detalle de corridas. */

const formatoPorcentaje = new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 });

/** 0.33333 (o '0.2', como llegan los parámetros) → '33.3 %'. */
export function porcentaje(fraccion: number | string | undefined): string {
  if (fraccion === undefined || fraccion === '') return '—';
  return formatoPorcentaje.format(Number(fraccion));
}

/** ISO de ejecución → '25/09/26, 02:15' en hora local. */
export function formatearFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * 'yyyy-mm-dd' → 'dd/mm/yyyy' sin pasar por Date: new Date('2026-08-05')
 * es medianoche UTC y en México se mostraría como el 4 de agosto.
 */
export function formatearDia(dia: string): string {
  const [anio, mes, d] = dia.split('-');
  return `${d}/${mes}/${anio}`;
}

const ESTADO: Record<AnalysisRunStatus, { texto: string; tono: 'positive' | 'negative' | 'warning' }> = {
  completada: { texto: 'Completada', tono: 'positive' },
  fallida: { texto: 'Fallida', tono: 'negative' },
  en_proceso: { texto: 'En proceso', tono: 'warning' },
};

export function EstadoCorridaBadge({ estado }: { estado: AnalysisRunStatus }) {
  return <Badge tone={ESTADO[estado].tono}>{ESTADO[estado].texto}</Badge>;
}
