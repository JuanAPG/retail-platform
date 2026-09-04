import { useMemo, useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { UseFetchState, useFetch } from '../../hooks/useFetch';
import { useAuth } from '../../context/AuthContext';
import { mensajeDeError } from '../../api/errores';
import { actualizarUsuario, getRoles } from '../../api/usuarios';
import { Usuario } from '../../types';
import { UsuarioFormModal } from './UsuarioFormModal';
import { ConfirmarEliminarModal } from './ConfirmarEliminarModal';

interface UsuariosPanelProps {
  estado: UseFetchState<Usuario[]>;
}

type FiltroEstado = 'todos' | 'activos' | 'inactivos';

function fechaCorta(iso: string | undefined): string {
  if (!iso) return '—';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(fecha);
}

export function UsuariosPanel({ estado }: UsuariosPanelProps) {
  const { usuario: usuarioEnSesion } = useAuth();
  const roles = useFetch(getRoles, []);

  const [busqueda, setBusqueda] = useState('');
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
        !texto ||
        u.nombre.toLowerCase().includes(texto) ||
        u.email.toLowerCase().includes(texto);
      const coincideRol = rol === 'todos' || u.rol === rol;
      const coincideEstado =
        filtroEstado === 'todos' ||
        (filtroEstado === 'activos' && u.activo) ||
        (filtroEstado === 'inactivos' && !u.activo);
      return coincideTexto && coincideRol && coincideEstado;
    });
  }, [usuarios, busqueda, rol, filtroEstado]);

  const hayFiltrosActivos = busqueda.trim() !== '' || rol !== 'todos' || filtroEstado !== 'todos';

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

  return (
    <section>
      <SectionHeader
        title="Gestión de Usuarios"
        description="Alta, edición, activación y baja de cuentas del sistema."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={estado.refetch}
              disabled={estado.loading}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {estado.loading ? 'Cargando…' : 'Actualizar'}
            </button>
            <button
              type="button"
              onClick={() => {
                setUsuarioEditando(undefined);
                setFormAbierto(true);
              }}
              disabled={!roles.data || roles.data.length === 0}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Nuevo usuario
            </button>
          </div>
        }
      />

      {aviso && (
        <div className="mb-4 flex items-start justify-between gap-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm text-emerald-800">{aviso}</p>
          <button
            type="button"
            onClick={() => setAviso(null)}
            aria-label="Cerrar aviso"
            className="text-sm text-emerald-700 hover:text-emerald-900"
          >
            ✕
          </button>
        </div>
      )}

      {errorAccion && (
        <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm text-rose-700">{errorAccion}</p>
        </div>
      )}

      {estado.error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-medium text-rose-800">No se pudieron cargar los usuarios</p>
          <p className="mt-0.5 text-sm text-rose-700">{estado.error}</p>
          <button
            type="button"
            onClick={estado.refetch}
            className="mt-2 rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
          >
            Reintentar
          </button>
        </div>
      )}

      {estado.loading && !estado.data && (
        <p className="text-sm text-slate-500">Cargando usuarios…</p>
      )}

      {estado.data && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label
                htmlFor="buscar-usuario"
                className="mb-1 block text-xs font-medium uppercase text-slate-500"
              >
                Buscar
              </label>
              <input
                id="buscar-usuario"
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre o correo…"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              />
            </div>

            <div>
              <label
                htmlFor="filtro-rol"
                className="mb-1 block text-xs font-medium uppercase text-slate-500"
              >
                Rol
              </label>
              <select
                id="filtro-rol"
                value={rol}
                onChange={(e) => setRol(e.target.value)}
                className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              >
                <option value="todos">Todos</option>
                {rolesEnUso.map((nombreRol) => (
                  <option key={nombreRol} value={nombreRol}>
                    {nombreRol}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filtro-estado"
                className="mb-1 block text-xs font-medium uppercase text-slate-500"
              >
                Estado
              </label>
              <select
                id="filtro-estado"
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value as FiltroEstado)}
                className="rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              >
                <option value="todos">Todos</option>
                <option value="activos">Activos</option>
                <option value="inactivos">Inactivos</option>
              </select>
            </div>

            {hayFiltrosActivos && (
              <button
                type="button"
                onClick={() => {
                  setBusqueda('');
                  setRol('todos');
                  setFiltroEstado('todos');
                }}
                className="rounded px-3 py-2 text-sm text-slate-500 underline hover:text-slate-700"
              >
                Limpiar filtros
              </button>
            )}
          </div>

          <p className="mb-2 text-xs text-slate-500">
            Mostrando {filtrados.length} de {usuarios.length}{' '}
            {usuarios.length === 1 ? 'usuario' : 'usuarios'}
          </p>

          {usuarios.length === 0 && (
            <EmptyState
              title="No hay usuarios registrados"
              description="Crea el primero con el botón «Nuevo usuario», o verifica que se haya ejecutado el seed de db/data_retail.sql."
            />
          )}

          {usuarios.length > 0 && filtrados.length === 0 && (
            <EmptyState
              title="Ningún usuario coincide con los filtros"
              description="Prueba con otro texto de búsqueda o limpia los filtros para ver la lista completa."
            />
          )}

          {filtrados.length > 0 && (
            <DataTable
              rowKey={(u) => u.id}
              rows={filtrados}
              columns={[
                {
                  header: 'Nombre',
                  render: (u) => (
                    <span>
                      {u.nombre}
                      {u.id === usuarioEnSesion?.id && (
                        <span className="ml-2 text-xs text-slate-400">(tú)</span>
                      )}
                    </span>
                  ),
                },
                { header: 'Correo', render: (u) => u.email },
                { header: 'Rol', render: (u) => <Badge>{u.rol}</Badge> },
                {
                  header: 'Estado',
                  render: (u) => (
                    <Badge tone={u.activo ? 'positive' : 'warning'}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </Badge>
                  ),
                },
                { header: 'Alta', render: (u) => fechaCorta(u.createdAt) },
                {
                  header: 'Acciones',
                  render: (u) => {
                    const esUnoMismo = u.id === usuarioEnSesion?.id;
                    return (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => abrirEdicion(u)}
                          className="text-sm text-slate-600 underline hover:text-slate-900"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => alternarActivo(u)}
                          disabled={esUnoMismo || cambiandoEstadoDe === u.id}
                          title={
                            esUnoMismo ? 'No puedes desactivar tu propia cuenta' : undefined
                          }
                          className="text-sm text-slate-600 underline hover:text-slate-900 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
                        >
                          {u.activo ? 'Desactivar' : 'Activar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setUsuarioAEliminar(u)}
                          disabled={esUnoMismo}
                          title={esUnoMismo ? 'No puedes eliminar tu propia cuenta' : undefined}
                          className="text-sm text-rose-600 underline hover:text-rose-800 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40"
                        >
                          Eliminar
                        </button>
                      </div>
                    );
                  },
                },
              ]}
            />
          )}
        </>
      )}

      {formAbierto && roles.data && (
        <UsuarioFormModal
          usuario={usuarioEditando}
          roles={roles.data}
          onCerrar={cerrarForm}
          onGuardado={trasGuardar}
        />
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
    </section>
  );
}
