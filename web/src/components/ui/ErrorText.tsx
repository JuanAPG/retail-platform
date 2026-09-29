import { ReactNode } from 'react';

interface ErrorTextProps {
  children: ReactNode;
}

/** DESIGN.md §5 — mismo aviso de error que los modales, para no dejar texto suelto sin fondo. */
export function ErrorText({ children }: ErrorTextProps) {
  return <p role="alert" className="rounded-full bg-vino/10 px-4 py-2.5 text-sm font-semibold text-vino">{children}</p>;
}
