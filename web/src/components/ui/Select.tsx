import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import { IconChevron } from './icons';

type OpcionElemento = ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;

interface SelectProps {
  id: string;
  label?: string;
  value: string | number;
  onChange: (e: { target: { value: string } }) => void;
  children: OpcionElemento | OpcionElemento[];
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
}

/**
 * DESIGN.md §5 — mismo lenguaje visual que Field (píldora, arena, borde
 * vino al enfocar). Reemplaza el `<select>` nativo: el navegador no deja
 * darle diseño propio a la lista de opciones abierta, así que se construye
 * como listbox propio. Acepta `<option>` como children para no tener que
 * tocar cada sitio que ya arma sus opciones así.
 *
 * El texto de `label` se pinta como `<span>`, no `<label htmlFor>`: si
 * envolviera todo el control (lista abierta incluida) en un `<label>`
 * asociado al botón, el navegador reenvía un click sintético al botón cada
 * vez que se elige una opción — reabriendo la lista justo al cerrarla.
 */
export function Select({ id, label, value, onChange, children, disabled, required, placeholder }: SelectProps) {
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const labelId = `${id}-label`;

  const opciones = (Array.isArray(children) ? children : [children]).filter(Boolean) as OpcionElemento[];
  const seleccionada = opciones.find((op) => String(op.props.value) === String(value));

  useEffect(() => {
    if (!abierto) return;
    function alClicFuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
    document.addEventListener('mousedown', alClicFuera);
    return () => document.removeEventListener('mousedown', alClicFuera);
  }, [abierto]);

  function elegir(op: OpcionElemento) {
    onChange({ target: { value: String(op.props.value) } });
    setAbierto(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <span id={labelId} className="text-[13px] font-semibold text-teal">
          {label}
        </span>
      )}
      <div ref={contenedorRef} className="relative">
        <input type="hidden" required={required} value={value} readOnly />
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={abierto}
          aria-labelledby={label ? labelId : undefined}
          onClick={() => setAbierto((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setAbierto(false);
            if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !abierto) {
              e.preventDefault();
              setAbierto(true);
            }
          }}
          className="flex h-14 w-full items-center justify-between gap-2.5 rounded-full border-2 border-transparent bg-arena px-5 text-left text-[15px] text-tinta transition focus:border-vino focus:bg-marfil focus:outline-none enabled:hover:border-salvia/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={seleccionada ? '' : 'text-salvia'}>
            {seleccionada ? seleccionada.props.children : placeholder ?? 'Selecciona…'}
          </span>
          <IconChevron className={`h-[18px] w-[18px] flex-shrink-0 text-teal transition-transform duration-200 ${abierto ? '-rotate-90' : 'rotate-90'}`} />
        </button>

        {abierto && (
          <ul
            role="listbox"
            aria-labelledby={label ? labelId : undefined}
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-64 overflow-y-auto rounded-card border-2 border-arena bg-marfil p-1.5 shadow-lift"
          >
            {opciones.map((op, i) => {
              const esActiva = String(op.props.value) === String(value);
              return (
                <li
                  key={op.key ?? op.props.value ?? i}
                  role="option"
                  aria-selected={esActiva}
                  aria-disabled={op.props.disabled}
                  onClick={() => !op.props.disabled && elegir(op)}
                  className={`cursor-pointer rounded-full px-4 py-2.5 text-[15px] transition ${
                    op.props.disabled
                      ? 'cursor-not-allowed text-salvia/60'
                      : esActiva
                        ? 'bg-vino font-semibold text-arena'
                        : 'text-teal hover:bg-salvia/20'
                  }`}
                >
                  {op.props.children}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
