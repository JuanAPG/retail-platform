import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import { actualizarUsuario, crearUsuario, ActualizarUsuarioPayload } from '../../api/usuarios';
import { Rol, Usuario } from '../../types';

interface UsuarioFormModalProps {
  /** `undefined` = alta; con usuario = edición. */
  usuario?: Usuario;
  roles: Rol[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}

/** Mismas reglas que valida el backend, para dar respuesta inmediata. */
function validarPassword(password: string): string | null {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    return 'La contraseña debe incluir al menos una mayúscula, una minúscula y un número.';
  }
  return null;
}

export function UsuarioFormModal({
  usuario,
  roles,
  onCerrar,
  onGuardado,
}: UsuarioFormModalProps) {
  const esEdicion = !!usuario;

  const [nombre, setNombre] = useState(usuario?.nombre ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [password, setPassword] = useState('');
  const [rolId, setRolId] = useState<number>(usuario?.rolId ?? roles[0]?.id ?? 0);
  const [activo, setActivo] = useState(usuario?.activo ?? true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!rolId) {
      setError('Debes seleccionar un rol.');
      return;
    }

    // En edición la contraseña es opcional: vacía significa "no la toques".
    if (!esEdicion || password) {
      const errorPassword = validarPassword(password);
      if (errorPassword) {
        setError(errorPassword);
        return;
      }
    }

    setGuardando(true);
    try {
      if (esEdicion) {
        // Solo se mandan los campos que de verdad cambiaron: así el
        // backend no reescribe el hash de la contraseña ni revalida un
        // correo que sigue siendo el mismo.
        const cambios: ActualizarUsuarioPayload = {};
        if (nombre !== usuario.nombre) cambios.nombre = nombre;
        if (email !== usuario.email) cambios.email = email;
        if (rolId !== usuario.rolId) cambios.rolId = rolId;
        if (activo !== usuario.activo) cambios.activo = activo;
        if (password) cambios.password = password;

        if (Object.keys(cambios).length === 0) {
          onCerrar();
          return;
        }

        await actualizarUsuario(usuario.id, cambios);
        onGuardado('Usuario actualizado correctamente.');
      } else {
        await crearUsuario({ nombre, email, password, rolId, activo });
        onGuardado('Usuario creado correctamente.');
      }
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar el usuario.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={esEdicion ? 'Editar usuario' : 'Nuevo usuario'}
      descripcion={
        esEdicion
          ? 'Modifica los datos de la cuenta. La contraseña solo cambia si escribes una nueva.'
          : 'Alta de una cuenta interna. El rol define a qué portal entra el usuario.'
      }
      onCerrar={onCerrar}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label
            htmlFor="usuario-nombre"
            className="mb-1 block text-xs font-medium uppercase text-slate-500"
          >
            Nombre completo
          </label>
          <input
            id="usuario-nombre"
            type="text"
            required
            minLength={3}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>

        <div>
          <label
            htmlFor="usuario-email"
            className="mb-1 block text-xs font-medium uppercase text-slate-500"
          >
            Correo electrónico
          </label>
          <input
            id="usuario-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>

        <div>
          <label
            htmlFor="usuario-password"
            className="mb-1 block text-xs font-medium uppercase text-slate-500"
          >
            Contraseña {esEdicion && <span className="normal-case text-slate-400">(opcional)</span>}
          </label>
          <input
            id="usuario-password"
            type="password"
            required={!esEdicion}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={esEdicion ? 'Déjala vacía para conservar la actual' : ''}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
          <p className="mt-1 text-xs text-slate-400">
            Mínimo 8 caracteres, con mayúscula, minúscula y número.
          </p>
        </div>

        <div>
          <label
            htmlFor="usuario-rol"
            className="mb-1 block text-xs font-medium uppercase text-slate-500"
          >
            Rol
          </label>
          <select
            id="usuario-rol"
            value={rolId}
            onChange={(e) => setRolId(Number(e.target.value))}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            {roles.map((rol) => (
              <option key={rol.id} value={rol.id}>
                {rol.nombre}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Cuenta activa (puede iniciar sesión)
        </label>

        {error && (
          <p role="alert" className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
