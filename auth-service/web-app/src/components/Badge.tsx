interface BadgeProps {
  children: React.ReactNode;
  tone?: 'neutral' | 'positive' | 'warning' | 'negative';
}

const TONE_CLASS: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  positive: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  negative: 'bg-rose-100 text-rose-700',
};

export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
