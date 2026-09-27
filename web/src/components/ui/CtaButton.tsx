import { ReactNode } from 'react';
import { IconMas } from './icons';

interface CtaButtonProps {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
  icon?: ReactNode;
}

/** DESIGN.md §5 — CTA: círculo con "+" que gira 90° al hover. */
export function CtaButton({ children, onClick, type = 'button', disabled, title, icon }: CtaButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="group flex h-[52px] items-center gap-2.5 rounded-full bg-vino pl-[18px] pr-6 text-[15px] font-bold text-arena transition hover:bg-arena hover:text-vino disabled:opacity-50"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-arena text-vino transition duration-300 group-hover:rotate-90 group-hover:bg-vino group-hover:text-arena">
        {icon ?? <IconMas className="h-[18px] w-[18px]" />}
      </span>
      {children}
    </button>
  );
}
