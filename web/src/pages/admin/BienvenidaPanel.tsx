import { StatCard } from '../../components/StatCard';
import { SectionHeader } from '../../components/SectionHeader';
import { Badge } from '../../components/Badge';
import { UseFetchState } from '../../hooks/useFetch';
import { useAuth } from '../../context/AuthContext';
import { Proveedor, Tienda, Usuario, Zona } from '../../types';

export type TabAdmin = 'inicio' | 'usuarios' | 'tiendas' | 'zonas' | 'proveedores' | 'auditoria';

interface BienvenidaPanelProps {
  usuarios: UseFetchState<Usuario[]>;
  tiendas: UseFetchState<Tienda[]>;
  zonas: UseFetchState<Zona[]>;
  proveedores: UseFetchState<Proveedor[]>;
  onIrA: (tab: TabAdmin) => void;
}

function saludoPorHora(hora: number): string {
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function fechaLarga(fecha: Date): string {
  const texto = new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(fecha);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Muestra el conteo solo cuando el dato realmente llegó: '…' mientras
 * carga y '—' si la petición falló. Así una API caída no se disfraza
 * de "0 usuarios registrados".
 */
function conteo<T>(estado: UseFetchState<T[]>): string | number {
  if (estado.loading) return '…';
  if (estado.error || !estado.data) return '—';
  return estado.data.length;
}

export function BienvenidaPanel({
  usuarios,
  tiendas,
  zonas,
  proveedores,
  onIrA,
}: BienvenidaPanelProps) {
  const { usuario } = useAuth();
  const ahora = new Date();

  const primerNombre = usuario?.nombre?.split(' ')[0] ?? '';
  const usuariosActivos = usuarios.data?.filter((u) => u.activo).length;
  const proveedoresPendientes = proveedores.data?.filter((p) => !p.activo) ?? [];

  // Con el backend apagado los cuatro GET fallan igual; basta con avisar
  // una vez en lugar de repetir el mismo error en cada tarjeta.
  const errorGeneral =
    usuarios.error ?? tiendas.error ?? zonas.error ?? proveedores.error ?? null;

  function recargarTodo() {
    usuarios.refetch();
    tiendas.refetch();
    zonas.refetch();
    proveedores.refetch();
  }

  return (
    <section>
      <SectionHeader
        title={`${saludoPorHora(ahora.getHours())}, ${primerNombre}`}
        description={fechaLarga(ahora)}
        action={
          <div className="flex items-center gap-2">
            <Badge tone="positive">{usuario?.rol}</Badge>
            <button
              type="button"
              onClick={recargarTodo}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Actualizar
            </button>
          </div>
        }
      />

      {errorGeneral && (
        <div className="mb-6 rounded border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-medium text-rose-800">
            No se pudieron cargar los indicadores
          </p>
          <p className="mt-0.5 text-sm text-rose-700">{errorGeneral}</p>
          <button
            type="button"
            onClick={recargarTodo}
            className="mt-2 rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
          >
            Reintentar
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Usuarios"
          value={conteo(usuarios)}
          hint={
            typeof usuariosActivos === 'number' ? `${usuariosActivos} activos` : 'Cuentas del sistema'
          }
        />
        <StatCard label="Tiendas" value={conteo(tiendas)} hint="Sucursales registradas" />
        <StatCard label="Zonas" value={conteo(zonas)} hint="Área Metropolitana" />
        <StatCard
          label="Proveedores"
          value={conteo(proveedores)}
          hint={
            proveedores.data
              ? `${proveedoresPendientes.length} pendientes de aprobación`
              : 'Empresas registradas'
          }
        />
      </div>

      {proveedoresPendientes.length > 0 && (
        <div className="mt-6 flex items-start justify-between gap-4 rounded border border-amber-200 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-amber-900">
              {proveedoresPendientes.length}{' '}
              {proveedoresPendientes.length === 1
                ? 'proveedor espera aprobación'
                : 'proveedores esperan aprobación'}
            </p>
            <p className="mt-0.5 text-sm text-amber-800">
              Se auto-registraron desde el portal público y su cuenta sigue inactiva hasta que el
              Administrador la revise.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onIrA('proveedores')}
            className="shrink-0 rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800"
          >
            Revisar
          </button>
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Accesos rápidos
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              { tab: 'usuarios', titulo: 'Ver usuarios', detalle: 'Cuentas, roles y estado' },
              { tab: 'tiendas', titulo: 'Ver tiendas', detalle: 'Sucursales y formatos' },
              { tab: 'zonas', titulo: 'Ver zonas', detalle: 'Cobertura por municipio' },
              { tab: 'proveedores', titulo: 'Ver proveedores', detalle: 'Empresas y solicitudes' },
            ] as const
          ).map((acceso) => (
            <button
              key={acceso.tab}
              type="button"
              onClick={() => onIrA(acceso.tab)}
              className="rounded border border-slate-200 px-4 py-3 text-left transition-colors hover:border-slate-400 hover:bg-slate-50"
            >
              <p className="text-sm font-medium text-slate-800">{acceso.titulo}</p>
              <p className="mt-0.5 text-xs text-slate-500">{acceso.detalle}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 rounded border border-slate-200 bg-slate-50 px-5 py-4">
        <p className="text-sm font-medium text-slate-700">Sobre este portal</p>
        <p className="mt-1 text-sm text-slate-500">
          Las secciones de consulta muestran datos reales de PostgreSQL. Las operaciones de alta,
          edición y baja todavía no tienen endpoint en el backend, por eso las pantallas son de
          solo lectura por ahora.
        </p>
      </div>
    </section>
  );
}
