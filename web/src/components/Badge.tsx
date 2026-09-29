import { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'warning' | 'negative';
}

const TONE_CLASS: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-arena text-teal',
  positive: 'bg-salvia text-tinta',
  warning: 'bg-vino/15 text-vino',
  negative: 'bg-vino text-arena',
};

/** DESIGN.md §5 — mismo lenguaje de pastilla que StatusPill, para etiquetas cortas fuera de tablas. */
export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
