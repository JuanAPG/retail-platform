interface CargandoProps {
  etiqueta?: string;
}

/** Indicador de carga con movimiento: el usuario sabe que la pantalla trabaja y no que se quedó vacía. */
export function Cargando({ etiqueta = 'Cargando…' }: CargandoProps) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 px-1 py-6 text-sm font-semibold text-teal">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-salvia border-t-vino" aria-hidden="true" />
      {etiqueta}
    </div>
  );
}
