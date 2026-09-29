import { ReactElement, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

interface Posicion {
  top: number;
  left: number;
  width: number;
  arriba: boolean;
}

/**
 * DESIGN.md §5 — mismo lenguaje visual que Field (píldora, arena, borde
 * vino al enfocar). Reemplaza el `<select>` nativo: el navegador no deja
 * darle diseño propio a la lista de opciones abierta, así que se construye
 * como listbox propio. Acepta `<option>` como children para no tener que
 * tocar cada sitio que ya arma sus opciones así.
 *
 * La lista abierta se pinta con un portal a `document.body`, en `position:
 * fixed`: antes vivía dentro del propio control y cualquier antepasado con
 * `overflow` (un Modal, una tarjeta) se la recortaba a la mitad. Se cierra
 * sola si algo hace scroll fuera de la lista, en vez de intentar
 * reposicionarla en vivo.
 *
 * El texto de `label` se pinta como `<span>`, no `<label htmlFor>`: si
 * envolviera todo el control (lista abierta incluida) en un `<label>`
 * asociado al botón, el navegador reenvía un click sintético al botón cada
 * vez que se elige una opción — reabriendo la lista justo al cerrarla.
 */
export function Select({ id, label, value, onChange, children, disabled, required, placeholder }: SelectProps) {
  const [abierto, setAbierto] = useState(false);
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const labelId = `${id}-label`;

  const opciones = (Array.isArray(children) ? children : [children]).filter(Boolean) as OpcionElemento[];
  const seleccionada = opciones.find((op) => String(op.props.value) === String(value));

  useLayoutEffect(() => {
    if (!abierto || !botonRef.current) return;
    const rect = botonRef.current.getBoundingClientRect();
    const espacioAbajo = window.innerHeight - rect.bottom;
    const arriba = espacioAbajo < 260 && rect.top > espacioAbajo;
    setPosicion({ top: arriba ? rect.top : rect.bottom, left: rect.left, width: rect.width, arriba });
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    function dentroDeAlgo(target: Node) {
      return (
        (contenedorRef.current?.contains(target) ?? false) || (listaRef.current?.contains(target) ?? false)
      );
    }
    function alClicFuera(e: MouseEvent) {
      if (!dentroDeAlgo(e.target as Node)) setAbierto(false);
    }
    function alHacerScroll(e: Event) {
      // Scroll dentro de la lista (revisando opciones largas) no la cierra;
      // scroll de cualquier otra cosa invalida la posición ya calculada.
      if (listaRef.current && e.target instanceof Node && listaRef.current.contains(e.target)) return;
      setAbierto(false);
    }
    document.addEventListener('mousedown', alClicFuera);
    window.addEventListener('scroll', alHacerScroll, true);
    window.addEventListener('resize', alHacerScroll);
    return () => {
      document.removeEventListener('mousedown', alClicFuera);
      window.removeEventListener('scroll', alHacerScroll, true);
      window.removeEventListener('resize', alHacerScroll);
    };
  }, [abierto]);

  function elegir(op: OpcionElemento) {
    onChange({ target: { value: String(op.props.value) } });
    setAbierto(false);
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label && (
        <span id={labelId} className="text-[13px] font-semibold text-teal">
          {label}
        </span>
      )}
      <div ref={contenedorRef} className="relative">
        <input type="hidden" required={required} value={value} readOnly />
        <button
          ref={botonRef}
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
          <span className={`min-w-0 truncate ${seleccionada ? '' : 'text-salvia'}`}>
            {seleccionada ? seleccionada.props.children : placeholder ?? 'Selecciona…'}
          </span>
          <IconChevron className={`h-[18px] w-[18px] flex-shrink-0 text-teal transition-transform duration-200 ${abierto ? '-rotate-90' : 'rotate-90'}`} />
        </button>

        {abierto &&
          posicion &&
          createPortal(
            <ul
              ref={listaRef}
              role="listbox"
              aria-labelledby={label ? labelId : undefined}
              style={{
                position: 'fixed',
                left: posicion.left,
                width: posicion.width,
                ...(posicion.arriba
                  ? { bottom: window.innerHeight - posicion.top + 6 }
                  : { top: posicion.top + 6 }),
              }}
              className="z-[100] max-h-64 overflow-y-auto rounded-card border-2 border-arena bg-marfil p-1.5 shadow-lift"
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
            </ul>,
            document.body,
          )}
      </div>
    </div>
  );
}
