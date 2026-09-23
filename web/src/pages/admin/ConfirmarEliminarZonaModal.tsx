import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import { eliminarZona } from '../../api/catalogo';
import { Zona } from '../../types';

interface ConfirmarEliminarZonaModalProps {
  zona: Zona;
  onCerrar: () => void;
  onEliminado: (mensaje: string) => void;
}

export function ConfirmarEliminarZonaModal({
  zona,
  onCerrar,
  onEliminado,
}: ConfirmarEliminarZonaModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState(false);

  async function confirmar() {
    setError(null);
    setEliminando(true);
    try {
      await eliminarZona(zona.id);
      onEliminado(`Se eliminó la zona "${zona.nombre}".`);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo eliminar la zona.'));
    } finally {
      setEliminando(false);
    }
  }

  return (
    <Modal titulo="Eliminar zona" descripcion="Esta acción no se puede deshacer." onCerrar={onCerrar}>
      <p className="text-sm text-slate-700">
        ¿Seguro que quieres eliminar <span className="font-medium">{zona.nombre}</span>?
      </p>
      <p className="mt-2 text-sm text-slate-500">
        Si hay tiendas asociadas a esta zona, es preferible desactivarla en vez de borrarla.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCerrar}
          className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirmar}
          disabled={eliminando}
          className="rounded bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-50"
        >
          {eliminando ? 'Eliminando…' : 'Sí, eliminar'}
        </button>
      </div>
    </Modal>
  );
}
