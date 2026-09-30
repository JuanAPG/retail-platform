const NOMBRE_INDICADOR: Record<string, string> = {
  demanda_estimada: 'Demanda estimada',
  ingreso_estimado: 'Ingreso estimado',
  desembolso: 'Desembolso total',
  precio_unitario: 'Precio unitario',
  demanda_historica: 'Demanda histórica',
  indice_accesibilidad: 'Índice de accesibilidad',
};

export function nombreIndicador(clave: string): string {
  return NOMBRE_INDICADOR[clave] ?? clave.replace(/_/g, ' ');
}

const formatoNumero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });

/** El backend ya manda el porcentaje multiplicado (15.5 = 15.5 %), no una fracción. */
export function variacion(valor: number | null): string {
  if (valor === null) return '—';
  const signo = valor > 0 ? '+' : '';
  return `${signo}${formatoNumero.format(valor)} %`;
}

export function numero(valor: number): string {
  return formatoNumero.format(valor);
}
