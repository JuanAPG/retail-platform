import { useEffect, useState, type FormEvent } from 'react';
import { ingestionApi } from '../../api/client';
import { mensajeDeError } from '../../api/errores';

type Batch = {
  id: string; state: string; createdAt: string; format: string;
  counts: { valid: number; repeated: number; rejected: number; conflicts: number; inserted: number };
};
type Page<T> = { data: T[]; total: number };
type SaleRow = { row: number; status: string; message?: string };
const base = '/transaction-imports';
const size = 20;

export function ImportarVentasPanel({ onImportado }: { onImportado: (message: string) => void }) {
  const [file, setFile] = useState<File>();
  const [batch, setBatch] = useState<Batch>();
  const [history, setHistory] = useState<Page<Batch>>();
  const [historyPage, setHistoryPage] = useState(1);
  const [rows, setRows] = useState<Page<SaleRow>>();
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void ingestionApi.get<Page<Batch>>(base, { params: { page: historyPage, limit: size }, signal: controller.signal })
      .then(({ data }) => setHistory(data)).catch((cause) => {
        if (!controller.signal.aborted) setError(mensajeDeError(cause));
      });
    return () => controller.abort();
  }, [historyPage, busy]);

  useEffect(() => {
    setRows(undefined);
    if (!batch) return;
    const controller = new AbortController();
    void ingestionApi.get<Page<SaleRow>>(`${base}/${batch.id}/rows`, { params: { page, limit: size }, signal: controller.signal })
      .then(({ data }) => setRows(data)).catch((cause) => {
        if (!controller.signal.aborted) setError(mensajeDeError(cause));
      });
    return () => controller.abort();
  }, [batch, page]);

  async function run(action: () => Promise<Batch>, confirmed = false) {
    setError('');
    setBusy(true);
    try {
      const result = await action();
      setPage(1);
      setBatch(result);
      if (confirmed) onImportado(`Ventas nuevas del lote: ${result.counts.inserted}. Filas repetidas: ${result.counts.repeated}.`);
    } catch (cause) {
      setError(mensajeDeError(cause));
    } finally {
      setBusy(false);
    }
  }

  function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    void run(() => ingestionApi.post<Batch>(base, body, { timeout: 120000 }).then(({ data }) => data));
  }

  const canConfirm = batch && ['vista_previa', 'confirmando'].includes(batch.state);
  return (
    <section className="grid gap-4 text-arena">
      <h2 className="font-display text-2xl">Importar ventas</h2>
      <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">Archivo CSV, JSON o XML
          <input type="file" accept=".csv,.json,.xml" required onChange={(event) => setFile(event.target.files?.[0])} />
        </label>
        <button className="underline" disabled={!file || busy} type="submit">Ver vista previa</button>
      </form>
      {busy && <p role="status">Procesando lote…</p>}
      {error && <p role="alert">{error}</p>}
      {batch && <div className="grid gap-3">
        <p>Estado {batch.state.replace(/_/g, ' ')} · {batch.counts.valid} válidas · {batch.counts.repeated} repetidas · {batch.counts.rejected} rechazadas · {batch.counts.conflicts} en conflicto · {batch.counts.inserted} ventas nuevas</p>
        <div className="flex gap-4">
          {canConfirm && <button type="button" className="underline" disabled={busy}
            onClick={() => void run(() => ingestionApi.post<Batch>(`${base}/${batch.id}/confirm`, undefined, { timeout: 0 }).then(({ data }) => data), true)}>Confirmar o reanudar lote</button>}
          {batch.state === 'vista_previa' && <button type="button" className="underline" disabled={busy}
            onClick={() => void run(() => ingestionApi.delete<Batch>(`${base}/${batch.id}`).then(({ data }) => data))}>Descartar lote</button>}
        </div>
        {rows && <div className="grid gap-2">
          <table><thead><tr><th scope="col">Fila</th><th scope="col">Estado</th><th scope="col">Detalle</th></tr></thead>
            <tbody>{rows.data.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.status}</td><td>{row.message}</td></tr>)}</tbody>
          </table>
          <div className="flex gap-4">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Filas anteriores</button>
            <button type="button" disabled={page * size >= rows.total} onClick={() => setPage(page + 1)}>Siguientes filas</button>
          </div>
        </div>}
      </div>}
      {history && history.total > 0 && <div className="grid gap-2">
        <h3 className="font-semibold">Lotes anteriores</h3>
        {history.data.map((item) => <button type="button" key={item.id} disabled={busy} className="text-left underline"
          onClick={() => { setPage(1); setBatch(item); }}>
          {new Date(item.createdAt).toLocaleString('es-MX')} · {item.format.toUpperCase()} · {item.state.replace(/_/g, ' ')}
        </button>)}
        <div className="flex gap-4">
          <button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage(historyPage - 1)}>Lotes anteriores</button>
          <button type="button" disabled={historyPage * size >= history.total} onClick={() => setHistoryPage(historyPage + 1)}>Siguientes lotes</button>
        </div>
      </div>}
    </section>
  );
}
