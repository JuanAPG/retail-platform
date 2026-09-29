import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  /** Botones de acción que solo se ven al hacer hover (`.acts` del prototipo). */
  actions?: ReactNode;
  onClick?: () => void;
  className?: string;
}

const CARD_CLASS =
  'group flex flex-col gap-3 rounded-card border-2 border-transparent bg-arena p-4 text-left transition hover:-translate-y-1.5 hover:border-salvia hover:shadow-lift';

/** DESIGN.md §5 — Tarjeta. */
export function Card({ children, actions, onClick, className = '' }: CardProps) {
  const contenido = (
    <>
      {children}
      {actions && (
        <div className="flex items-center gap-1.5 opacity-35 transition group-hover:opacity-100">{actions}</div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${CARD_CLASS} ${className}`}>
        {contenido}
      </button>
    );
  }

  return <article className={`${CARD_CLASS} ${className}`}>{contenido}</article>;
}
