import { ReactNode, useEffect } from 'react';
import { IconCerrar } from './ui/icons';

interface ModalProps {
  titulo: string;
  descripcion?: string;
  onCerrar: () => void;
  children: ReactNode;
}

export function Modal({ titulo, descripcion, onCerrar, children }: ModalProps) {
  // Escape cierra el modal, como espera cualquier usuario de escritorio.
  useEffect(() => {
    function alPresionar(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar();
    }
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-tinta/50" onClick={onCerrar} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-panel bg-marfil p-8 shadow-lift"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-vino">{titulo}</h2>
            {descripcion && <p className="mt-1 text-sm text-teal">{descripcion}</p>}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-arena text-teal transition hover:bg-teal hover:text-arena"
          >
            <IconCerrar className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
