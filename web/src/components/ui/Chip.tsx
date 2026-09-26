import { ReactNode } from 'react';

interface ChipProps {
  children: ReactNode;
  active?: boolean;
  count?: number;
  onClick?: () => void;
}

/** DESIGN.md §5 — Chip / filtro. */
export function Chip({ children, active, count, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full border-2 px-4 text-sm font-semibold transition ${
        active
          ? 'border-transparent bg-vino text-arena'
          : 'border-transparent bg-arena text-teal hover:border-salvia'
      }`}
    >
      {children}
      {typeof count === 'number' && <b className="font-data text-xs font-semibold opacity-75">{count}</b>}
    </button>
  );
}
