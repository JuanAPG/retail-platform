import { useMemo, useState } from 'react';
import { UseFetchState, useFetch } from '../../hooks/useFetch';
import { useAuth } from '../../context/AuthContext';
import { mensajeDeError } from '../../api/errores';
import { actualizarUsuario, getRoles } from '../../api/usuarios';
import { Usuario } from '../../types';
import { Hero } from '../../components/ui/Hero';
import { Chip } from '../../components/ui/Chip';
import { Card } from '../../components/ui/Card';
import { StatusPill } from '../../components/ui/StatusPill';
import { CircleButton } from '../../components/ui/CircleButton';
import { Switch } from '../../components/ui/Switch';
import { IconMas, IconOjo, IconCerrar as IconEliminar, IconUsuarios } from '../../components/ui/icons';
import { UsuarioFormModal } from './UsuarioFormModal';
import { ConfirmarEliminarModal } from './ConfirmarEliminarModal';

interface UsuariosPanelProps {
  estado: UseFetchState<Usuario[]>;
  busqueda: string;
}

type FiltroEstado = 'todos' | 'activos' | 'inactivos';

/** Círculo de iniciales coloreado por rol, como en Admin.dc.html. */
const COLOR_POR_ROL: Record<string, string> = {
  Administrador: 'bg-vino text-arena',
  'Gerente de categoría': 'bg-teal text-arena',
  'Responsable de precios': 'bg-salvia text-tinta',
  'Analista comercial': 'bg-tinta text-arena',
  Auditor: 'bg-vino text-arena',
  Planeador: 'bg-teal text-arena',
};

function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

/** M-Usuarios — mismo CRUD de siempre (alta, edición, activar/desactivar, baja), solo rediseñado. */
export function UsuariosPanel({ estado, busqueda }: UsuariosPanelProps) {
  const { usuario: usuarioEnSesion } = useAuth();
  const roles = useFetch(getRoles, []);

  const [rol, setRol] = useState('todos');
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos');

  const [formAbierto, setFormAbierto] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState<Usuario | undefined>();
  const [usuarioAEliminar, setUsuarioAEliminar] = useState<Usuario | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [cambiandoEstadoDe, setCambiandoEstadoDe] = useState<string | null>(null);

  const usuarios = estado.data ?? [];

  // Los roles del filtro salen de los datos y no de una lista fija: si
  // el equipo agrega un rol nuevo a la tabla `roles`, aparece aquí solo.
  const rolesEnUso = useMemo(
    () => Array.from(new Set(usuarios.map((u) => u.rol).filter(Boolean))).sort(),
    [usuarios],
  );

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return usuarios.filter((u) => {
      const coincideTexto =
        !texto || u.nombre.toLowerCase().includes(texto) || u.email.toLowerCase().includes(texto);
      const coincideRol = rol === 'todos' || u.rol === rol;
      const coincideEstado =
        filtroEstado === 'todos' ||
        (filtroEstado === 'activos' && u.activo) ||
        (filtroEstado === 'inactivos' && !u.activo);
      return coincideTexto && coincideRol && coincideEstado;
    });
  }, [usuarios, busqueda, rol, filtroEstado]);

  function cerrarForm() {
    setFormAbierto(false);
    setUsuarioEditando(undefined);
  }

  function trasGuardar(mensaje: string) {
    cerrarForm();
    setErrorAccion(null);
    setAviso(mensaje);
    estado.refetch();
  }

  function abrirEdicion(usuario: Usuario) {
    setUsuarioEditando(usuario);
    setFormAbierto(true);
  }

  async function alternarActivo(usuario: Usuario) {
    setErrorAccion(null);
    setAviso(null);
    setCambiandoEstadoDe(usuario.id);
    try {
      await actualizarUsuario(usuario.id, { activo: !usuario.activo });
      setAviso(
        usuario.activo
          ? `Se desactivó la cuenta de ${usuario.nombre}.`
          : `Se activó la cuenta de ${usuario.nombre}.`,
      );
      estado.refetch();
    } catch (err) {
      setErrorAccion(mensajeDeError(err, 'No se pudo cambiar el estado del usuario.'));
    } finally {
      setCambiandoEstadoDe(null);
    }
  }

  const activos = usuarios.filter((u) => u.activo).length;

  return (
    <div className="flex flex-col gap-6">
      <Hero
        title="Usuarios"
        subtitle="Roles internos del sistema"
        action={
          <button
            type="button"
            onClick={() => {
              setUsuarioEditando(undefined);
              setFormAbierto(true);
            }}
            disabled={!roles.data || roles.data.length === 0}
            className="group flex h-[52px] items-center gap-2.5 rounded-full bg-vino py-0 pl-4.5 pr-6 text-[15px] font-bold text-arena transition hover:bg-arena hover:text-vino disabled:opacity-50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-arena text-vino transition duration-300 group-hover:rotate-90 group-hover:bg-vino group-hover:text-arena">
              <IconMas className="h-[18px] w-[18px]" />
            </span>
            Nuevo usuario
          </button>
        }
        decorations={
          <>
            <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
              <IconUsuarios className="mt-8 h-[74px] w-[74px]" />
            </div>
            <div className="absolute right-[26px] top-[22px] flex h-[108px] w-[108px] flex-col items-center justify-center gap-0.5 rounded-full bg-arena text-teal">
              <span className="font-display text-[34px] leading-none">{activos}</span>
              <span className="text-[11px] font-semibold">activos</span>
            </div>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={rol === 'todos'} onClick={() => setRol('todos')} count={usuarios.length}>
          Todos
        </Chip>
        {rolesEnUso.map((nombreRol) => (
          <Chip
            key={nombreRol}
            active={rol === nombreRol}
            onClick={() => setRol(nombreRol)}
            count={usuarios.filter((u) => u.rol === nombreRol).length}
          >
            {nombreRol}
          </Chip>
        ))}
        <span className="mx-1 h-6 w-px bg-salvia/30" />
        <Chip active={filtroEstado === 'activos'} onClick={() => setFiltroEstado(filtroEstado === 'activos' ? 'todos' : 'activos')}>
          Activos
        </Chip>
        <Chip active={filtroEstado === 'inactivos'} onClick={() => setFiltroEstado(filtroEstado === 'inactivos' ? 'todos' : 'inactivos')}>
          Inactivos
        </Chip>
      </div>

      {aviso && (
        <div className="flex items-center justify-between gap-4 rounded-full bg-salvia/25 px-5 py-3">
          <p className="text-sm font-semibold text-teal">{aviso}</p>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="text-sm text-teal">
            ✕
          </button>
        </div>
      )}
      {errorAccion && (
        <div className="rounded-full bg-vino/10 px-5 py-3">
          <p className="text-sm font-semibold text-vino">{errorAccion}</p>
        </div>
      )}
      {estado.error && (
        <div className="rounded-panel border-2 border-dashed border-vino/40 px-5 py-4">
          <p className="text-sm font-semibold text-vino">No se pudieron cargar los usuarios: {estado.error}</p>
        </div>
      )}

      {estado.data && usuarios.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
            <IconUsuarios className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">No hay usuarios registrados</p>
        </div>
      )}

      {usuarios.length > 0 && filtrados.length === 0 && (
        <div className="rounded-panel border-2 border-dashed border-salvia py-10 text-center">
          <p className="font-display text-xl text-teal">Ningún usuario coincide con la búsqueda</p>
        </div>
      )}

      {filtrados.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtrados.map((u) => {
            const esUnoMismo = u.id === usuarioEnSesion?.id;
            return (
              <Card
                key={u.id}
                actions={
                  <>
                    <CircleButton icon={<IconOjo className="h-[19px] w-[19px]" />} label={`Ver ${u.nombre}`} onClick={() => abrirEdicion(u)} />
                    <CircleButton
                      icon={<IconEliminar className="h-[19px] w-[19px]" />}
                      label={`Eliminar ${u.nombre}`}
                      variant="delete"
                      onClick={() => setUsuarioAEliminar(u)}
                    />
                  </>
                }
              >
                <div className="flex items-center gap-3.5">
                  <span
                    className={`flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full text-xl font-bold transition group-hover:rotate-[-10deg] group-hover:scale-[1.06] ${
                      COLOR_POR_ROL[u.rol] ?? 'bg-salvia text-tinta'
                    }`}
                  >
                    {iniciales(u.nombre)}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-display text-[19px] leading-tight text-tinta">
                      {u.nombre}
                      {esUnoMismo && <span className="ml-1.5 text-xs text-salvia">(tú)</span>}
                    </span>
                    <span className="truncate font-data text-xs text-teal">{u.email}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <StatusPill tone="neutral">{u.rol}</StatusPill>
                </div>

                <div className="flex items-center justify-between">
                  <Switch
                    checked={u.activo}
                    onChange={() => alternarActivo(u)}
                    disabled={esUnoMismo || cambiandoEstadoDe === u.id}
                  >
                    {cambiandoEstadoDe === u.id ? '…' : u.activo ? 'Activo' : 'Inactivo'}
                  </Switch>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {formAbierto && roles.data && (
        <UsuarioFormModal usuario={usuarioEditando} roles={roles.data} onCerrar={cerrarForm} onGuardado={trasGuardar} />
      )}

      {usuarioAEliminar && (
        <ConfirmarEliminarModal
          usuario={usuarioAEliminar}
          onCerrar={() => setUsuarioAEliminar(null)}
          onEliminado={(mensaje) => {
            setUsuarioAEliminar(null);
            setErrorAccion(null);
            setAviso(mensaje);
            estado.refetch();
          }}
        />
      )}
    </div>
  );
}
