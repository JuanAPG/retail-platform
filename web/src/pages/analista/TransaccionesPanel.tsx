import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { useFetch } from '../../hooks/useFetch';
import { getTransacciones } from '../../api/transacciones';
import { getProductos, getTiendas } from '../../api/catalogo';
import { TransaccionFormModal } from './TransaccionFormModal';
import { ImportarCsvPanel } from './ImportarCsvPanel';

/**
 * M06 — Transacciones. Lista lo registrado, da de alta manual y recibe
 * el CSV (preview → confirm). Cada guardado construye su canasta en el
 * backend (M07), así que aquí no hay que hacer nada más tras guardar.
 */
export function TransaccionesPanel() {
  const transacciones = useFetch(getTransacciones, []);
  const tiendas = useFetch(getTiendas, []);
  const productos = useFetch(getProductos, []);

  const [formAbierto, setFormAbierto] = useState(false);
  const [importacionAbierta, setImportacionAbierta] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const filas = transacciones.data ?? [];

  function trasGuardar(mensaje: string) {
    setFormAbierto(false);
    setAviso(mensaje);
    transacciones.refetch();
  }

  return (
    <section>
      <SectionHeader
        title="Transacciones"
        description="Registro de operaciones en tiendas. Cada transacción construye su canasta al guardarse."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={transacciones.refetch}
              disabled={transacciones.loading}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {transacciones.loading ? 'Cargando…' : 'Actualizar'}
            </button>
            <button
              type="button"
              onClick={() => setImportacionAbierta((v) => !v)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Importar CSV
            </button>
            <button
              type="button"
              onClick={() => setFormAbierto(true)}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Nueva transacción
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

      {importacionAbierta && (
        <div className="mb-4">
          <ImportarCsvPanel
            onImportado={(mensaje) => {
              setAviso(mensaje);
              transacciones.refetch();
            }}
          />
        </div>
      )}

      {transacciones.loading && <p className="text-sm text-slate-500">Cargando…</p>}
      {transacciones.error && <p className="text-sm text-red-600">{transacciones.error}</p>}
      {!transacciones.loading && !transacciones.error && filas.length === 0 && (
        <EmptyState
          title="Aún no hay transacciones registradas"
          description="Importa un lote de transacciones o registra una manualmente para empezar a construir canastas e indicadores."
        />
      )}
      {filas.length > 0 && (
        <DataTable
          rowKey={(t) => t.id}
          rows={filas}
          columns={[
            { header: 'Folio', render: (t) => t.folio },
            { header: 'Tienda', render: (t) => t.store?.nombre ?? '—' },
            { header: 'Fecha', render: (t) => new Date(t.date).toLocaleDateString('es-MX') },
            { header: 'Líneas', render: (t) => t.details?.length ?? 0 },
            { header: 'Total', render: (t) => `$${Number(t.total).toFixed(2)}` },
            { header: 'Origen', render: (t) => (t.importacionId ? 'CSV' : 'Manual') },
          ]}
        />
      )}

      {formAbierto && (
        <TransaccionFormModal
          tiendas={tiendas.data ?? []}
          productos={productos.data ?? []}
          onCerrar={() => setFormAbierto(false)}
          onGuardado={trasGuardar}
        />
      )}
    </section>
  );
}
