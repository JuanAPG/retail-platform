import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { useFetch } from '../../hooks/useFetch';
import { getSegmentos } from '../../api/segmentos';
import { IncomeSegment } from '../../types';
import { SegmentoFormModal } from './SegmentoFormModal';
import { ConfirmarEliminarSegmentoModal } from './ConfirmarEliminarSegmentoModal';

function formatoMoneda(valor: string | number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(Number(valor));
}

function formatoRango(min: string, max: string | null): string {
  if (max == null) return `${formatoMoneda(min)}+`;
  return `${formatoMoneda(min)} – ${formatoMoneda(max)}`;
}

/**
 * M05 — Segmentos de ingreso. CRUD completo (RN-01, RN-02): el rango
 * numérico solo no basta, cada segmento debe traer su justificación
 * (fuente, frecuencia, relación con zona, limitaciones), que se captura
 * en el formulario y viaja tal cual al backend.
 */
export function SegmentosPanel() {
  const segmentos = useFetch(getSegmentos, []);

  const [formAbierto, setFormAbierto] = useState(false);
  const [segmentoEditando, setSegmentoEditando] = useState<IncomeSegment | undefined>();
  const [segmentoAEliminar, setSegmentoAEliminar] = useState<IncomeSegment | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const filas = segmentos.data ?? [];

  function cerrarForm() {
    setFormAbierto(false);
    setSegmentoEditando(undefined);
  }

  function trasGuardar(mensaje: string) {
    cerrarForm();
    setErrorAccion(null);
    setAviso(mensaje);
    segmentos.refetch();
  }

  function abrirEdicion(segmento: IncomeSegment) {
    setSegmentoEditando(segmento);
    setFormAbierto(true);
  }

  return (
    <section>
      <SectionHeader
        title="Segmentos de ingreso"
        description="Rangos de ingreso usados para clasificar zonas y canastas por capacidad de compra (RN-01, RN-02)."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={segmentos.refetch}
              disabled={segmentos.loading}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {segmentos.loading ? 'Cargando…' : 'Actualizar'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSegmentoEditando(undefined);
                setFormAbierto(true);
              }}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Nuevo segmento
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

      {segmentos.error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-medium text-rose-800">No se pudieron cargar los segmentos</p>
          <p className="mt-0.5 text-sm text-rose-700">{segmentos.error}</p>
          <button
            type="button"
            onClick={segmentos.refetch}
            className="mt-2 rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
          >
            Reintentar
          </button>
        </div>
      )}

      {segmentos.loading && !segmentos.data && (
        <p className="text-sm text-slate-500">Cargando segmentos…</p>
      )}

      {segmentos.data && filas.length === 0 && (
        <EmptyState
          title="Aún no hay segmentos configurados"
          description="Crea el primero con el botón «Nuevo segmento» para poder clasificar zonas por capacidad de compra."
        />
      )}

      {filas.length > 0 && (
        <DataTable
          rowKey={(s) => String(s.id)}
          rows={filas}
          columns={[
            { header: 'Código', render: (s) => s.code },
            { header: 'Nombre', render: (s) => s.name },
            {
              header: 'Rango de ingreso',
              render: (s) => formatoRango(s.incomeRangeMin, s.incomeRangeMax),
            },
            {
              header: 'Fuente',
              render: (s) => (
                <span className="line-clamp-2 max-w-xs text-xs text-slate-500" title={s.source}>
                  {s.source}
                </span>
              ),
            },
            {
              header: 'Acciones',
              render: (s) => (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => abrirEdicion(s)}
                    className="text-sm text-slate-600 underline hover:text-slate-900"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setSegmentoAEliminar(s)}
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

      {formAbierto && (
        <SegmentoFormModal
          segmento={segmentoEditando}
          onCerrar={cerrarForm}
          onGuardado={trasGuardar}
        />
      )}

      {segmentoAEliminar && (
        <ConfirmarEliminarSegmentoModal
          segmento={segmentoAEliminar}
          onCerrar={() => setSegmentoAEliminar(null)}
          onEliminado={(mensaje) => {
            setSegmentoAEliminar(null);
            setErrorAccion(null);
            setAviso(mensaje);
            segmentos.refetch();
          }}
        />
      )}
    </section>
  );
}
