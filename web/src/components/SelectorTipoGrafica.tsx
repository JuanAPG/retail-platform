interface OpcionTipo<T extends string> {
  clave: T;
  etiqueta: string;
  /** Una línea que dice qué enseña esta forma de ver los datos. */
  ayuda: string;
  /** Si no se puede elegir con los datos actuales, aquí va el motivo. */
  noDisponible?: string;
}

interface SelectorTipoGraficaProps<T extends string> {
  opciones: OpcionTipo<T>[];
  valor: T;
  onChange: (clave: T) => void;
  nombre: string;
}

/**
 * Interruptor de tipo de gráfica, arriba a la derecha de la gráfica: los mismos datos
 * vistos de otra forma. Es un grupo de botones (accesible con teclado y lector de pantalla).
 */
export function SelectorTipoGrafica<T extends string>({ opciones, valor, onChange, nombre }: SelectorTipoGraficaProps<T>) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1 rounded-full bg-marfil p-1" role="group" aria-label={`Tipo de gráfica de ${nombre}`}>
        {opciones.map((o) => (
          <button
            key={o.clave}
            type="button"
            title={o.noDisponible ?? o.ayuda}
            aria-pressed={valor === o.clave}
            disabled={!!o.noDisponible}
            onClick={() => onChange(o.clave)}
            className={`flex h-9 items-center rounded-full px-3.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              valor === o.clave ? 'bg-vino text-arena' : 'text-teal hover:bg-salvia/25'
            }`}
          >
            {o.etiqueta}
          </button>
        ))}
      </div>
      <span className="max-w-xs text-right text-[11px] text-teal/70">{opciones.find((o) => o.clave === valor)?.ayuda}</span>
    </div>
  );
}
