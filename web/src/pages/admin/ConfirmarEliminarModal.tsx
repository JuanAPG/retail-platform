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
      <p className="text-sm text-tinta">
        ¿Seguro que quieres eliminar la cuenta de{' '}
        <span className="font-semibold">{usuario.nombre}</span> ({usuario.email})?
      </p>
      <p className="mt-2 text-sm text-teal">
        Si solo quieres impedirle el acceso, es preferible desactivar la cuenta: así se conserva
        su historial en el sistema.
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
