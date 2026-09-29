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
      <p className="text-sm text-tinta">
        ¿Seguro que quieres eliminar <span className="font-semibold">{tienda.nombre}</span>?
      </p>
      <p className="mt-2 text-sm text-teal">
        Si la tienda tiene transacciones u otros registros asociados, es preferible desactivarla en
        vez de borrarla — así se conserva su historial.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-full bg-vino/10 px-4 py-2.5 text-sm font-semibold text-vino">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2.5">
        <button
          type="button"
          onClick={onCerrar}
          className="flex h-11 items-center rounded-full border-2 border-salvia/60 px-5 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirmar}
          disabled={eliminando}
          className="flex h-11 items-center rounded-full bg-vino px-5 text-sm font-bold text-arena transition hover:bg-teal disabled:opacity-50"
        >
          {eliminando ? 'Eliminando…' : 'Sí, eliminar'}
        </button>
      </div>
    </Modal>
  );
}
