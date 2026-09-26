import { ReactNode } from 'react';

interface HeroProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Círculos decorativos superpuestos (`.kc`/`.orb` del prototipo). Posicionarlos con `absolute`. */
  decorations?: ReactNode;
  className?: string;
}

/** DESIGN.md §5 — Hero. */
export function Hero({ title, subtitle, action, decorations, className = '' }: HeroProps) {
  return (
    <section className={`relative h-[240px] overflow-hidden rounded-hero bg-teal p-10 text-arena ${className}`}>
      <div className="relative z-[2] flex h-full flex-col justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-7xl font-normal leading-[0.95]">{title}</h1>
          {subtitle && <span className="font-display text-2xl text-salvia">{subtitle}</span>}
        </div>
        {action && <div className="flex gap-3">{action}</div>}
      </div>
      {decorations}
    </section>
  );
}
