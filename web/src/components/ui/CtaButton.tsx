import { motion } from 'motion/react';
import { ReactNode } from 'react';
import { IconMas } from './icons';
import { FILL_DURATION, FILL_EASE, useOriginFill } from './useOriginFill';

interface CtaButtonProps {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
  icon?: ReactNode;
}

/**
 * DESIGN.md §5 — CTA. La animación es un relleno circular que crece
 * desde donde el usuario hace hover/click (no un simple cambio de
 * color): arena se expande sobre vino y el texto invierte a vino.
 */
export function CtaButton({ children, onClick, type = 'button', disabled, title, icon }: CtaButtonProps) {
  const { ref, origen, diametro, mostrarRelleno, handlers } = useOriginFill<HTMLButtonElement>(disabled);

  return (
    <motion.button
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      {...handlers}
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
