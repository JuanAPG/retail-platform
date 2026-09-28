import { Badge } from '../../components/Badge';
import { ElasticityClass } from '../../types';

/**
 * M11 — Etiquetas, colores y formatos compartidos por la tabla de
 * resultados y el gráfico: la misma clasificación se ve igual en ambos.
 */
export const CLASIFICACION: Record<
  ElasticityClass,
  { texto: string; tono: 'negative' | 'positive' | 'neutral'; barra: string }
> = {
  elastic: { texto: 'Elástica', tono: 'negative', barra: 'bg-rose-400' },
  inelastic: { texto: 'Inelástica', tono: 'positive', barra: 'bg-emerald-400' },
  unitary: { texto: 'Unitaria', tono: 'neutral', barra: 'bg-slate-400' },
};

export function ClasificacionBadge({ clase }: { clase: ElasticityClass }) {
  return <Badge tone={CLASIFICACION[clase].tono}>{CLASIFICACION[clase].texto}</Badge>;
}

/** E > 0: la demanda subió con el precio. */
export function AtipicaBadge() {
  return <Badge tone="warning">Atípica</Badge>;
}

const dosDecimales = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

/** Elasticidad con signo explícito: +0.87 / −9.07. */
export function formatearE(valor: number): string {
  const texto = Math.abs(valor).toLocaleString('es-MX', dosDecimales);
  return valor > 0 ? `+${texto}` : valor < 0 ? `−${texto}` : texto;
}

export function formatearR2(valor: number | null): string {
  return valor === null ? '—' : valor.toLocaleString('es-MX', dosDecimales);
}

export const GRANULARIDAD: Record<'day' | 'week', string> = { day: 'por día', week: 'por semana' };
