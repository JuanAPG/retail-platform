import { FormEvent, useState } from 'react';
import { Modal } from '../../components/Modal';
import { mensajeDeError } from '../../api/errores';
import { actualizarUsuario, crearUsuario, ActualizarUsuarioPayload } from '../../api/usuarios';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { Switch } from '../../components/ui/Switch';
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
        <Field
          id="usuario-nombre"
          label="Nombre completo"
          required
          minLength={3}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />

        <Field
          id="usuario-email"
          label="Correo electrónico"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div>
          <Field
            id="usuario-password"
            label={esEdicion ? 'Contraseña (opcional)' : 'Contraseña'}
            type="password"
            required={!esEdicion}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={esEdicion ? 'Déjala vacía para conservar la actual' : ''}
          />
          <p className="mt-1.5 text-xs text-teal/70">
            Mínimo 8 caracteres, con mayúscula, minúscula y número.
          </p>
        </div>

        <Select id="usuario-rol" label="Rol" value={rolId} onChange={(e) => setRolId(Number(e.target.value))}>
          {roles.map((rol) => (
            <option key={rol.id} value={rol.id}>
              {rol.nombre}
            </option>
          ))}
        </Select>

        <Switch checked={activo} onChange={setActivo}>
          Cuenta activa (puede iniciar sesión)
        </Switch>

        {error && (
          <p role="alert" className="rounded-full bg-vino/10 px-4 py-2.5 text-sm font-semibold text-vino">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onCerrar}
            className="flex h-11 items-center rounded-full border-2 border-salvia/60 px-5 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex h-11 items-center rounded-full bg-vino px-5 text-sm font-bold text-arena transition hover:bg-teal disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
