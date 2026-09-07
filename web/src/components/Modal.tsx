import { ReactNode, useEffect } from 'react';

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
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onCerrar}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold text-slate-900">{titulo}</h2>
        {descripcion && <p className="mt-1 text-sm text-slate-500">{descripcion}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
