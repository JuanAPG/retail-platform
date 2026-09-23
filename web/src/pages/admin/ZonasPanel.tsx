import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { UseFetchState, useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { actualizarZona, getMunicipios } from '../../api/catalogo';
import { Zona } from '../../types';
import { ZonaFormModal } from './ZonaFormModal';
import { ConfirmarEliminarZonaModal } from './ConfirmarEliminarZonaModal';

interface ZonasPanelProps {
  estado: UseFetchState<Zona[]>;
}

/** M03 — Zonas. CRUD completo: antes era una tabla de solo lectura. */
export function ZonasPanel({ estado }: ZonasPanelProps) {
  const municipios = useFetch(getMunicipios, []);

  const [formAbierto, setFormAbierto] = useState(false);
  const [zonaEditando, setZonaEditando] = useState<Zona | undefined>();
  const [zonaAEliminar, setZonaAEliminar] = useState<Zona | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [cambiandoEstadoDe, setCambiandoEstadoDe] = useState<string | null>(null);

  const zonas = estado.data ?? [];

  function cerrarForm() {
    setFormAbierto(false);
    setZonaEditando(undefined);
  }

  function trasGuardar(mensaje: string) {
    cerrarForm();
    setErrorAccion(null);
    setAviso(mensaje);
    estado.refetch();
  }

  function abrirEdicion(zona: Zona) {
    setZonaEditando(zona);
    setFormAbierto(true);
  }

  async function alternarActivo(zona: Zona) {
    setErrorAccion(null);
    setAviso(null);
    setCambiandoEstadoDe(zona.id);
    try {
      await actualizarZona(zona.id, { activo: !zona.activo });
      setAviso(
        zona.activo ? `Se desactivó la zona "${zona.nombre}".` : `Se activó la zona "${zona.nombre}".`,
      );
      estado.refetch();
    } catch (err) {
      setErrorAccion(mensajeDeError(err, 'No se pudo cambiar el estado de la zona.'));
    } finally {
      setCambiandoEstadoDe(null);
    }
  }

  return (
    <section>
      <SectionHeader
        title="Zonas"
        description="Zonas geográficas del Área Metropolitana. Alta, edición y baja."
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
                setZonaEditando(undefined);
                setFormAbierto(true);
              }}
              disabled={!municipios.data || municipios.data.length === 0}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Nueva zona
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
          <p className="text-sm font-medium text-rose-800">No se pudieron cargar las zonas</p>
          <p className="mt-0.5 text-sm text-rose-700">{estado.error}</p>
        </div>
      )}

      {estado.loading && !estado.data && <p className="text-sm text-slate-500">Cargando zonas…</p>}

      {estado.data && zonas.length === 0 && (
        <EmptyState title="No hay zonas registradas" description="Crea la primera con «Nueva zona»." />
      )}

      {zonas.length > 0 && (
        <DataTable
          rowKey={(z) => z.id}
          rows={zonas}
          columns={[
            { header: 'Nombre', render: (z) => z.nombre },
            { header: 'Municipio', render: (z) => z.municipio?.nombre },
            { header: 'Descripción', render: (z) => z.descripcion ?? '—' },
            {
              header: 'Estado',
              render: (z) => (
                <Badge tone={z.activo ? 'positive' : 'neutral'}>{z.activo ? 'Activo' : 'Inactivo'}</Badge>
              ),
            },
            {
              header: 'Acciones',
              render: (z) => (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => abrirEdicion(z)}
                    className="text-sm text-slate-600 underline hover:text-slate-900"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => alternarActivo(z)}
                    disabled={cambiandoEstadoDe === z.id}
                    className="text-sm text-slate-600 underline hover:text-slate-900 disabled:opacity-40"
                  >
                    {z.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setZonaAEliminar(z)}
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

      {formAbierto && municipios.data && (
        <ZonaFormModal
          zona={zonaEditando}
          municipios={municipios.data}
          onCerrar={cerrarForm}
          onGuardado={trasGuardar}
        />
      )}

      {zonaAEliminar && (
        <ConfirmarEliminarZonaModal
          zona={zonaAEliminar}
          onCerrar={() => setZonaAEliminar(null)}
          onEliminado={(mensaje) => {
            setZonaAEliminar(null);
            setErrorAccion(null);
            setAviso(mensaje);
            estado.refetch();
          }}
        />
      )}
    </section>
  );
}
