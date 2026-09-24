import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import { eliminarTienda } from '../../api/catalogo';
import { Tienda } from '../../types';

interface ConfirmarEliminarTiendaModalProps {
  tienda: Tienda;
  onCerrar: () => void;
  onEliminado: (mensaje: string) => void;
}

export function ConfirmarEliminarTiendaModal({
  tienda,
  onCerrar,
  onEliminado,
}: ConfirmarEliminarTiendaModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState(false);

  async function confirmar() {
    setError(null);
    setEliminando(true);
    try {
      await eliminarTienda(tienda.id);
      onEliminado(`Se eliminó la tienda "${tienda.nombre}".`);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo eliminar la tienda.'));
    } finally {
      setEliminando(false);
    }
  }

  return (
    <Modal titulo="Eliminar tienda" descripcion="Esta acción no se puede deshacer." onCerrar={onCerrar}>
      <p className="text-sm text-slate-700">
        ¿Seguro que quieres eliminar <span className="font-medium">{tienda.nombre}</span>?
      </p>
      <p className="mt-2 text-sm text-slate-500">
        Si la tienda tiene transacciones u otros registros asociados, es preferible desactivarla en
        vez de borrarla — así se conserva su historial.
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
