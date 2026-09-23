import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { UseFetchState, useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { actualizarTienda, getCodigosPostales, getZonas } from '../../api/catalogo';
import { Tienda } from '../../types';
import { TiendaFormModal } from './TiendaFormModal';
import { ConfirmarEliminarTiendaModal } from './ConfirmarEliminarTiendaModal';

interface TiendasPanelProps {
  estado: UseFetchState<Tienda[]>;
}

const ETIQUETA_FORMATO: Record<string, string> = {
  supermercado: 'Supermercado',
  minimarket: 'Minimarket',
  tienda_conveniencia: 'Tienda de conveniencia',
  mayorista: 'Mayorista',
  otro: 'Otro',
};

/**
 * M02 — Tiendas. CRUD completo (RF-05, RF-06): antes solo había una
 * tabla de solo lectura, sin forma de dar de alta, editar o desactivar
 * una sucursal.
 */
export function TiendasPanel({ estado }: TiendasPanelProps) {
  const zonas = useFetch(getZonas, []);
  const codigosPostales = useFetch(getCodigosPostales, []);

  const [formAbierto, setFormAbierto] = useState(false);
  const [tiendaEditando, setTiendaEditando] = useState<Tienda | undefined>();
  const [tiendaAEliminar, setTiendaAEliminar] = useState<Tienda | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [cambiandoEstadoDe, setCambiandoEstadoDe] = useState<string | null>(null);

  const tiendas = estado.data ?? [];

  function cerrarForm() {
    setFormAbierto(false);
    setTiendaEditando(undefined);
  }

  function trasGuardar(mensaje: string) {
    cerrarForm();
    setErrorAccion(null);
    setAviso(mensaje);
    estado.refetch();
  }

  function abrirEdicion(tienda: Tienda) {
    setTiendaEditando(tienda);
    setFormAbierto(true);
  }

  async function alternarActivo(tienda: Tienda) {
    setErrorAccion(null);
    setAviso(null);
    setCambiandoEstadoDe(tienda.id);
    try {
      await actualizarTienda(tienda.id, { activo: !tienda.activo });
      setAviso(
        tienda.activo
          ? `Se desactivó la tienda "${tienda.nombre}".`
          : `Se activó la tienda "${tienda.nombre}".`,
      );
      estado.refetch();
    } catch (err) {
      setErrorAccion(mensajeDeError(err, 'No se pudo cambiar el estado de la tienda.'));
    } finally {
      setCambiandoEstadoDe(null);
    }
  }

  const puedeAbrirForm = (zonas.data?.length ?? 0) > 0 && (codigosPostales.data?.length ?? 0) > 0;

  return (
    <section>
      <SectionHeader
        title="Tiendas"
        description="Sucursales físicas registradas. Alta, edición y baja."
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
                setTiendaEditando(undefined);
                setFormAbierto(true);
              }}
              disabled={!puedeAbrirForm}
              title={!puedeAbrirForm ? 'Necesitas al menos una zona y un código postal' : undefined}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Nueva tienda
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
          <p className="text-sm font-medium text-rose-800">No se pudieron cargar las tiendas</p>
          <p className="mt-0.5 text-sm text-rose-700">{estado.error}</p>
        </div>
      )}

      {estado.loading && !estado.data && <p className="text-sm text-slate-500">Cargando tiendas…</p>}

      {estado.data && tiendas.length === 0 && (
        <EmptyState
          title="No hay tiendas registradas"
          description="Crea la primera con el botón «Nueva tienda»."
        />
      )}

      {tiendas.length > 0 && (
        <DataTable
          rowKey={(t) => t.id}
          rows={tiendas}
          columns={[
            { header: 'Nombre', render: (t) => t.nombre },
            {
              header: 'Dirección',
              render: (t) =>
                [t.direccion?.calle, t.direccion?.numeroExterior, t.direccion?.colonia]
                  .filter(Boolean)
                  .join(' '),
            },
            { header: 'CP', render: (t) => t.direccion?.codigoPostal ?? '—' },
            { header: 'Zona', render: (t) => t.zona?.nombre },
            { header: 'Formato', render: (t) => ETIQUETA_FORMATO[t.formato] ?? t.formato },
            {
              header: 'Estado',
              render: (t) => (
                <Badge tone={t.activo ? 'positive' : 'neutral'}>
                  {t.activo ? 'Activo' : 'Inactivo'}
                </Badge>
              ),
            },
            {
              header: 'Acciones',
              render: (t) => (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => abrirEdicion(t)}
                    className="text-sm text-slate-600 underline hover:text-slate-900"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => alternarActivo(t)}
                    disabled={cambiandoEstadoDe === t.id}
                    className="text-sm text-slate-600 underline hover:text-slate-900 disabled:opacity-40"
                  >
                    {t.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTiendaAEliminar(t)}
                    className="text-sm text-rose-600 underline hover:text-rose-800"
                  >
                    Eliminar
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      {formAbierto && zonas.data && codigosPostales.data && (
        <TiendaFormModal
          tienda={tiendaEditando}
          zonas={zonas.data}
          codigosPostales={codigosPostales.data}
          onCerrar={cerrarForm}
          onGuardado={trasGuardar}
        />
      )}

      {tiendaAEliminar && (
        <ConfirmarEliminarTiendaModal
          tienda={tiendaAEliminar}
          onCerrar={() => setTiendaAEliminar(null)}
          onEliminado={(mensaje) => {
            setTiendaAEliminar(null);
            setErrorAccion(null);
            setAviso(mensaje);
            estado.refetch();
          }}
        />
      )}
    </section>
  );
}
