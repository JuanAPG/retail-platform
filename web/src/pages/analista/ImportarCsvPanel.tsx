import { useRef, useState } from 'react';
import { mensajeDeError } from '../../api/errores';
import { confirmarCsv, previsualizarCsv } from '../../api/transacciones';
import { CsvImportResult, CsvPreview } from '../../types';
import { StatusPill } from '../../components/ui/StatusPill';
import { IconCerrar, IconCheck } from '../../components/ui/icons';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [resultado, setResultado] = useState<CsvImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  function elegirArchivo(f: File | null) {
    setArchivo(f);
    setPreview(null);
    setResultado(null);
    setError(null);
    if (f) void handlePreview(f);
  }

  async function handlePreview(f: File) {
    setError(null);
    setResultado(null);
    setCargando(true);
    try {
      setPreview(await previsualizarCsv(f));
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

  function limpiar() {
    setArchivo(null);
    setPreview(null);
    setResultado(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="flex flex-col gap-4">
      {!archivo && (
        <label className="flex cursor-pointer items-center gap-4 rounded-panel border-2 border-dashed border-salvia/50 bg-arena p-5 text-arena transition hover:border-arena hover:bg-teal">
          <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-vino text-arena">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
              <path d="M12 16V4M7 9l5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="font-display text-lg text-teal">Importar transacciones</span>
            <span className="font-data text-xs text-teal/70">CSV · folio, fecha, tienda, sku, presentación, cantidad, precio</span>
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>
      )}

      {archivo && (
        <div className="flex flex-wrap items-center gap-2.5">
          {cargando && <StatusPill tone="neutral">Validando…</StatusPill>}
          {preview && (
            <>
              <StatusPill tone="ok" icon={<IconCheck className="h-3.5 w-3.5" />}>
                {preview.filasValidas} válidas
              </StatusPill>
              {preview.filasConError > 0 && <StatusPill tone="warn">{preview.filasConError} con error</StatusPill>}
            </>
          )}
          <button
            type="button"
            onClick={limpiar}
            className="flex h-10 items-center gap-2 rounded-full bg-teal px-4 text-sm font-semibold text-arena transition hover:bg-vino"
          >
            {archivo.name}
            <IconCerrar className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {error && <p className="rounded-full bg-vino/10 px-5 py-3 text-sm font-semibold text-vino">{error}</p>}

      {preview && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-teal">
            <strong>{preview.filasValidas}</strong> filas válidas de <strong>{preview.filasTotales}</strong> →{' '}
            <strong>{preview.transaccionesDetectadas}</strong> transacciones detectadas.
          </p>

          {preview.grupos.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {preview.grupos.map((g) => (
                <div key={`${g.folio}-${g.tiendaId}-${g.fecha}`} className="flex flex-col gap-1 rounded-card bg-arena p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-data text-xs font-semibold text-teal">{g.folio}</span>
                    <span className="font-data text-sm font-semibold text-vino">${g.totalEstimado.toFixed(2)}</span>
                  </div>
                  <span className="text-sm font-bold text-tinta">{g.tienda}</span>
                  <span className="text-xs text-teal/70">{g.fecha} · {g.lineas} líneas</span>
                </div>
              ))}
            </div>
          )}

          {preview.errores.length > 0 && (
            <div className="flex flex-col gap-2">
              {preview.errores.map((e) => (
                <div key={`${e.fila}-${e.columna}-${e.codigo}-${e.mensaje}`} className="flex items-center gap-3 rounded-full bg-vino/10 px-4 py-2.5">
                  <span className="font-data text-xs font-semibold text-vino">{e.fila ?? '—'}</span>
                  <span className="font-data rounded-full bg-vino px-2 py-0.5 text-[11px] text-arena">{e.codigo}</span>
                  <span className="text-xs text-vino">{e.mensaje}</span>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={preview.filasValidas === 0 || cargando}
            title={preview.filasValidas === 0 ? 'No hay filas válidas que confirmar' : undefined}
            className="flex h-[52px] w-fit items-center rounded-full bg-vino px-6 text-[15px] font-bold text-arena transition hover:bg-teal disabled:opacity-50"
          >
            {cargando ? 'Confirmando…' : `Confirmar (${preview.filasValidas} filas)`}
          </button>
        </div>
      )}

      {resultado && resultado.omitidos.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-vino">Grupos omitidos al confirmar:</p>
          {resultado.omitidos.map((o) => (
            <div key={`${o.folio}-${o.tienda}`} className="flex items-center gap-3 rounded-full bg-marfil px-4 py-2.5 text-xs text-teal">
              <span className="font-data font-semibold">{o.folio}</span>
              <span>{o.tienda}</span>
              <span className="text-teal/70">{o.motivo}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
