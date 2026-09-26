import { ReactNode } from 'react';

type CircleButtonVariant = 'default' | 'delete' | 'accent';
type CircleButtonSize = 'sm' | 'md';

interface CircleButtonProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  variant?: CircleButtonVariant;
  size?: CircleButtonSize;
  type?: 'button' | 'submit';
}

const VARIANT_CLASS: Record<CircleButtonVariant, string> = {
  default: 'bg-marfil text-teal hover:bg-teal hover:text-arena',
  delete: 'bg-marfil text-teal hover:bg-vino hover:text-arena',
  accent: 'bg-vino text-arena hover:bg-arena hover:text-vino',
};

const SIZE_CLASS: Record<CircleButtonSize, string> = {
  sm: 'size-10',
  md: 'size-11',
};

/** DESIGN.md §5 — Botón circular de acción. `label` es el aria-label: siempre solo ícono. */
export function CircleButton({ icon, label, onClick, variant = 'default', size = 'md', type = 'button' }: CircleButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      aria-label={label}
      className={`flex flex-shrink-0 items-center justify-center rounded-full transition hover:scale-110 ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]}`}
    >
      {icon}
    </button>
  );
}
