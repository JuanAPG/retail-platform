import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import { eliminarUsuario } from '../../api/usuarios';
import { Usuario } from '../../types';

interface ConfirmarEliminarModalProps {
  usuario: Usuario;
  onCerrar: () => void;
  onEliminado: (mensaje: string) => void;
}

/**
 * Confirmación propia en vez de `window.confirm`: permite mostrar el
 * error del backend (por ejemplo, cuando el usuario tiene registros
 * asociados y hay que desactivarlo en lugar de borrarlo) sin cerrar
 * el diálogo.
 */
export function ConfirmarEliminarModal({
  usuario,
  onCerrar,
  onEliminado,
}: ConfirmarEliminarModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState(false);

  async function confirmar() {
    setError(null);
    setEliminando(true);
    try {
      await eliminarUsuario(usuario.id);
      onEliminado(`Se eliminó la cuenta de ${usuario.nombre}.`);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo eliminar el usuario.'));
    } finally {
      setEliminando(false);
    }
  }

  return (
    <Modal
      titulo="Eliminar usuario"
      descripcion="Esta acción no se puede deshacer."
      onCerrar={onCerrar}
    >
      <p className="text-sm text-slate-700">
        ¿Seguro que quieres eliminar la cuenta de{' '}
        <span className="font-medium">{usuario.nombre}</span> ({usuario.email})?
      </p>
      <p className="mt-2 text-sm text-slate-500">
        Si solo quieres impedirle el acceso, es preferible desactivar la cuenta: así se conserva
        su historial en el sistema.
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
