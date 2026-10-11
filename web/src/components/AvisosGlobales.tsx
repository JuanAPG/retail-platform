import { useEffect, useState } from 'react';
import { Aviso, escucharAvisos, textoDeAviso } from '../api/avisos';

interface AvisoVisible extends Aviso {
  id: number;
}

const DURACION_MS = 7000;

/** Toasts de caídas de servicio y 403: se montan una vez, en la raíz. */
export function AvisosGlobales() {
  const [avisos, setAvisos] = useState<AvisoVisible[]>([]);

  useEffect(() => {
    let siguiente = 0;
    return escucharAvisos((aviso) => {
      const id = ++siguiente;
      setAvisos((previos) => [...previos.slice(-2), { ...aviso, id }]);
      window.setTimeout(() => setAvisos((previos) => previos.filter((a) => a.id !== id)), DURACION_MS);
    });
  }, []);

  if (avisos.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[min(92vw,380px)] flex-col gap-2" aria-live="assertive">
      {avisos.map((a) => (
        <div key={a.id} role="alert" className="flex items-start gap-3 rounded-[24px] bg-vino px-5 py-4 text-sm text-arena shadow-lift">
          <span className="flex-1">{textoDeAviso(a)}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setAvisos((previos) => previos.filter((x) => x.id !== a.id))}
            className="font-bold opacity-80 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
