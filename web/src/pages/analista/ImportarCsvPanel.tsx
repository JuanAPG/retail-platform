import { useState } from 'react';
import { mensajeDeError } from '../../api/errores';
import { confirmarCsv, previsualizarCsv } from '../../api/transacciones';
import { CsvImportResult, CsvPreview } from '../../types';
import { DataTable } from '../../components/DataTable';

interface ImportarCsvPanelProps {
  onImportado: (mensaje: string) => void;
}

/**
 * M06 — Importación CSV en dos pasos: preview (valida, nada inserta)
 * y confirm (inserta las filas válidas y construye sus canastas).
 *
 * Formato esperado (delimitador `,` o `;`):
 *   folio,fecha,tienda,sku,presentacion,cantidad,precio
 * Las filas con el mismo folio + tienda + fecha forman una transacción.
 */
export function ImportarCsvPanel({ onImportado }: ImportarCsvPanelProps) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [resultado, setResultado] = useState<CsvImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handlePreview() {
    if (!archivo) {
      setError('Elige un archivo CSV primero.');
      return;
    }
    setError(null);
    setResultado(null);
    setCargando(true);
    try {
      setPreview(await previsualizarCsv(archivo));
    } catch (err) {
      setPreview(null);
      setError(mensajeDeError(err, 'No se pudo validar el archivo.'));
    } finally {
      setCargando(false);
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setError(null);
    setCargando(true);
    try {
      const res = await confirmarCsv(preview.importacionId);
      setResultado(res);
      setPreview(null);
      setArchivo(null);
      onImportado(
        `Importación confirmada: ${res.transaccionesCreadas} transacciones y ${res.canastasCreadas} canastas.` +
          (res.omitidos.length > 0 ? ` (${res.omitidos.length} grupos omitidos.)` : ''),
      );
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo confirmar la importación.'));
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Importar CSV</h3>
      <p className="mt-1 text-xs text-slate-500">
        Columnas: <code>folio,fecha,tienda,sku,presentacion,cantidad,precio</code>. La tienda va con su nombre
        exacto (p. ej. «Super Valle Centro»), el producto por SKU y la presentación por nombre.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null);
            setPreview(null);
            setResultado(null);
            setError(null);
          }}
          className="text-sm text-slate-600"
        />
        <button
          type="button"
          onClick={handlePreview}
          disabled={!archivo || cargando}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {cargando ? 'Validando…' : 'Validar archivo'}
        </button>
      </div>

      {error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {preview && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-700">
            <strong>{preview.filasValidas}</strong> filas válidas de <strong>{preview.filasTotales}</strong>
            {' '}→ <strong>{preview.transaccionesDetectadas}</strong> transacciones detectadas.
            {preview.filasConError > 0 && (
              <span className="text-amber-700"> ({preview.filasConError} filas con error: no se insertarán.)</span>
            )}
          </p>

          {preview.grupos.length > 0 && (
            <DataTable
              rowKey={(g) => `${g.folio}-${g.tiendaId}-${g.fecha}`}
              rows={preview.grupos}
              columns={[
                { header: 'Folio', render: (g) => g.folio },
                { header: 'Tienda', render: (g) => g.tienda },
                { header: 'Fecha', render: (g) => g.fecha },
                { header: 'Líneas', render: (g) => g.lineas },
                { header: 'Total est.', render: (g) => `$${g.totalEstimado.toFixed(2)}` },
              ]}
            />
          )}

          {preview.errores.length > 0 && (
            <DataTable
              rowKey={(e) => `${e.fila}-${e.columna}-${e.codigo}-${e.mensaje}`}
              rows={preview.errores}
              columns={[
                { header: 'Fila', render: (e) => e.fila ?? '—' },
                { header: 'Código', render: (e) => <code className="text-xs">{e.codigo}</code> },
                { header: 'Detalle', render: (e) => e.mensaje },
              ]}
            />
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={preview.filasValidas === 0 || cargando}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              title={preview.filasValidas === 0 ? 'No hay filas válidas que confirmar' : undefined}
            >
              {cargando ? 'Confirmando…' : `Confirmar (${preview.filasValidas} filas)`}
            </button>
          </div>
        </div>
      )}

      {resultado && resultado.omitidos.length > 0 && (
        <div className="mt-3">
          <p className="text-sm font-medium text-amber-800">Grupos omitidos al confirmar:</p>
          <DataTable
            rowKey={(o) => `${o.folio}-${o.tienda}`}
            rows={resultado.omitidos}
            columns={[
              { header: 'Folio', render: (o) => o.folio },
              { header: 'Tienda', render: (o) => o.tienda },
              { header: 'Motivo', render: (o) => o.motivo },
            ]}
          />
        </div>
      )}
    </div>
  );
}
