import { ReactNode } from 'react';

type StatusTone = 'ok' | 'warn' | 'neutral';

interface StatusPillProps {
  tone: StatusTone;
  children: ReactNode;
  icon?: ReactNode;
}

const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'bg-salvia text-tinta',
  warn: 'bg-vino text-arena',
  neutral: 'bg-marfil text-teal',
};

/**
 * DESIGN.md §5 — Pastilla de estado. El vino es advertencia, nunca
 * decoración: `children` siempre debe llevar el texto del estado
 * (Suspendido, Vencido, ERROR…), regla §1.6.
 */
export function StatusPill({ tone, children, icon }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${TONE_CLASS[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}
