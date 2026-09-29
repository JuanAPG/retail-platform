import { motion } from 'motion/react';
import { ReactNode, useCallback, useRef, useState } from 'react';
import { IconMas } from './icons';

interface CtaButtonProps {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
  icon?: ReactNode;
}

const FILL_DURATION = 0.5;
const FILL_EASE = [0.16, 1, 0.3, 1] as const;

/** Diámetro mínimo para que el círculo, creciendo desde (x, y), cubra toda la pastilla. */
function coverDiameter(width: number, height: number, x: number, y: number): number {
  return Math.ceil(
    2 *
      Math.max(
        Math.hypot(x, y),
        Math.hypot(width - x, y),
        Math.hypot(x, height - y),
        Math.hypot(width - x, height - y),
      ),
  );
}

/**
 * DESIGN.md §5 — CTA. La animación es un relleno circular que crece
 * desde donde el usuario hace hover/click (no un simple cambio de
 * color): arena se expande sobre vino y el texto invierte a vino.
 */
export function CtaButton({ children, onClick, type = 'button', disabled, title, icon }: CtaButtonProps) {
  const botonRef = useRef<HTMLButtonElement>(null);
  const [activo, setActivo] = useState(false);
  const [origen, setOrigen] = useState({ x: 0, y: 0 });
  const [diametro, setDiametro] = useState(0);

  const actualizarOrigen = useCallback((x: number, y: number) => {
    const nodo = botonRef.current;
    if (!nodo) return;
    const rect = nodo.getBoundingClientRect();
    setOrigen({ x, y });
    setDiametro(coverDiameter(rect.width, rect.height, x, y));
  }, []);

  const desdePuntero = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      actualizarOrigen(e.clientX - rect.left, e.clientY - rect.top);
    },
    [actualizarOrigen],
  );

  const desdeCentro = useCallback(() => {
    const nodo = botonRef.current;
    if (!nodo) return;
    const rect = nodo.getBoundingClientRect();
    actualizarOrigen(rect.width / 2, rect.height / 2);
  }, [actualizarOrigen]);

  const mostrarRelleno = !disabled && activo;

  return (
    <motion.button
      ref={botonRef}
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      onPointerEnter={(e) => {
        if (disabled) return;
        desdePuntero(e);
        setActivo(true);
      }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        desdePuntero(e);
        setActivo(true);
      }}
      onPointerLeave={() => setActivo(false)}
      onPointerCancel={() => setActivo(false)}
      onFocus={(e) => {
        if (disabled) return;
        if (e.currentTarget.matches(':focus-visible')) {
          desdeCentro();
          setActivo(true);
        }
      }}
      onBlur={() => setActivo(false)}
      className="relative flex h-[52px] items-center gap-2.5 overflow-hidden rounded-full bg-vino pl-[18px] pr-6 text-[15px] font-bold text-arena transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    >
      <motion.span
        aria-hidden
        initial={false}
        animate={{ scale: mostrarRelleno && diametro > 0 ? 1 : 0 }}
        transition={{ duration: FILL_DURATION, ease: FILL_EASE }}
        className="pointer-events-none absolute rounded-full bg-arena"
        style={{ left: origen.x - diametro / 2, top: origen.y - diametro / 2, width: diametro, height: diametro }}
      />
      <span
        className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
          mostrarRelleno ? 'rotate-90 bg-vino text-arena' : 'bg-arena text-vino'
        }`}
      >
        {icon ?? <IconMas className="h-[18px] w-[18px]" />}
      </span>
      <span className={`relative z-10 transition-colors ${mostrarRelleno ? 'text-vino' : 'text-arena'}`}>{children}</span>
    </motion.button>
  );
}
