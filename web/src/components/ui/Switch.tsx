import { ReactNode } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
  /** `vino` solo en la pantalla de Acceso; el resto usa `teal` (DESIGN.md §5). */
  tone?: 'teal' | 'vino';
  disabled?: boolean;
}

/** DESIGN.md §5 — Switch. */
export function Switch({ checked, onChange, children, tone = 'teal', disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-3 text-sm font-semibold text-teal disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={`relative h-8 w-[52px] flex-shrink-0 rounded-full transition-colors ${
          checked ? (tone === 'vino' ? 'bg-vino' : 'bg-teal') : 'bg-salvia/35 group-hover:bg-salvia/60'
        }`}
      >
        <span
          className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-marfil transition-transform ${
            checked ? 'translate-x-5 bg-arena' : ''
          }`}
        />
      </span>
      {children}
    </button>
  );
}
