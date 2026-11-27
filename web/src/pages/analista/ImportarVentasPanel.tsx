import { useEffect, useState, type FormEvent } from 'react';
import { ingestionApi } from '../../api/client';
import { mensajeDeError } from '../../api/errores';
import { getProductos, getTiendas } from '../../api/catalogo';
import { useFetch } from '../../hooks/useFetch';
import { listaSegura } from '../../api/seguro';
import { Producto, Tienda } from '../../types';

/** Columnas del archivo (contrato de transactions-ingestion-service), explicadas para quien lo arma. */
const COLUMNAS: { nombre: string; que: string; ejemplo: string }[] = [
  { nombre: 'folio', que: 'Número del ticket. Junto con la tienda identifica la venta: si lo repites, no se duplica.', ejemplo: 'T-000123' },
  { nombre: 'fecha', que: 'Día de la venta, en formato año-mes-día.', ejemplo: '2026-11-20' },
  { nombre: 'tienda', que: 'Nombre de la tienda tal como aparece en el módulo Tiendas (sin importar mayúsculas).', ejemplo: 'Super Valle Centro' },
  { nombre: 'sku', que: 'Clave (SKU) del producto, como aparece en el catálogo.', ejemplo: 'LDN-LEC' },
  { nombre: 'presentacion', que: 'Nombre de la presentación del producto (por ejemplo, el tamaño).', ejemplo: '1 L' },
  { nombre: 'cantidad', que: 'Piezas vendidas. Mayor que cero, hasta 2 decimales.', ejemplo: '2' },
  { nombre: 'precio', que: 'Precio unitario en pesos (MXN), sin el signo $. Mayor que cero, hasta 2 decimales, con punto decimal.', ejemplo: '42.50' },
];

const ESTADO_LOTE: Record<string, string> = {
  vista_previa: 'Vista previa: revisa las filas y confirma',
  confirmando: 'Guardando las ventas…',
  conciliacion: 'Hay filas en conflicto que requieren revisión',
  confirmado: 'Importado',
  descartado: 'Descartado',
};

const ESTADO_FILA: Record<string, string> = {
  valida: 'Lista para importar',
  repetida: 'Ya estaba importada (no se duplica)',
  rechazada: 'Con error: corrígela en el archivo',
  conflicto: 'Mismo folio con datos distintos',
};

/** Plantilla CSV con los encabezados correctos y una fila de ejemplo tomada del catálogo real. */
function descargarPlantilla(tienda?: Tienda, producto?: Producto) {
  const pres = producto?.presentaciones?.find((p) => p.activo !== false);
  const fila = [
    'T-000123',
    new Date().toISOString().slice(0, 10),
    tienda?.nombre ?? 'Super Valle Centro',
    producto?.sku ?? 'LDN-LEC',
    pres?.nombre ?? '1 L',
    '2',
    '42.50',
  ];
  const celda = (v: string) => (/[,"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = `folio,fecha,tienda,sku,presentacion,cantidad,precio\r\n${fila.map(celda).join(',')}\r\n`;
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla-ventas.csv';
  a.click();
  URL.revokeObjectURL(url);
}

type Batch = {
  id: string; state: string; createdAt: string; format: string;
  counts: { valid: number; repeated: number; rejected: number; conflicts: number; inserted: number };
};
type Page<T> = { data: T[]; total: number };
type SaleRow = { row: number; status: string; message?: string };
const base = '/transaction-imports';
const size = 20;

export function ImportarVentasPanel({ onImportado }: { onImportado: (message: string) => void }) {
  const tiendas = useFetch(getTiendas, []);
  const productos = useFetch(getProductos, []);
  const [ayuda, setAyuda] = useState(true);
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
      <ol className="grid gap-1 text-sm">
        <li><b>1.</b> Prepara tu archivo con las columnas de abajo (o descarga la plantilla).</li>
        <li><b>2.</b> Súbelo y revisa la vista previa: todavía no se guarda nada.</li>
        <li><b>3.</b> Si las filas están bien, confirma. Las filas con error no se importan; corrígelas y vuelve a subir el archivo.</li>
      </ol>

      <div className="grid gap-2 rounded-[22px] bg-tinta/20 p-4 text-sm" data-testid="ayuda-importacion">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Cómo debe estar compuesto el archivo</h3>
          <div className="flex gap-3">
            <button
              type="button"
              className="underline"
              onClick={() =>
                descargarPlantilla(
                  listaSegura<Tienda>(tiendas.data).find((t) => t.activo !== false),
                  listaSegura<Producto>(productos.data).find((p) => (p.presentaciones ?? []).length > 0),
                )
              }
            >
              Descargar plantilla CSV
            </button>
            <button type="button" className="underline" onClick={() => setAyuda(!ayuda)}>{ayuda ? 'Ocultar ayuda' : 'Ver ayuda'}</button>
          </div>
        </div>
        {ayuda && (
          <>
            <p>
              La primera fila lleva los encabezados, escritos exactamente así y en este orden:{' '}
              <code className="rounded bg-tinta/30 px-1">folio,fecha,tienda,sku,presentacion,cantidad,precio</code>. Cada fila siguiente es un
              producto vendido; un ticket con varios productos usa el mismo folio en varias filas.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <thead>
                  <tr><th scope="col" className="pr-3">Columna</th><th scope="col" className="pr-3">Qué va</th><th scope="col">Ejemplo</th></tr>
                </thead>
                <tbody>
                  {COLUMNAS.map((c) => (
                    <tr key={c.nombre} className="align-top">
                      <td className="pr-3 font-data">{c.nombre}</td>
                      <td className="pr-3">{c.que}</td>
                      <td className="font-data">{c.ejemplo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="grid list-disc gap-1 pl-5">
              <li>Guárdalo como <b>CSV UTF-8</b> (en Excel: «CSV UTF-8 (delimitado por comas)»). Se acepta coma o punto y coma como separador.</li>
              <li>Hasta 10,000 filas y 8 MB por archivo. Si tienes más, divídelo en varios archivos.</li>
              <li>Sin signo $ ni separadores de miles en cantidad y precio: escribe <span className="font-data">1250.50</span>, no <span className="font-data">$1,250.50</span>.</li>
              <li>También se acepta JSON o XML con los mismos campos (para sistemas que exportan en esos formatos).</li>
            </ul>
          </>
        )}
      </div>

      <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">Archivo de ventas (CSV, JSON o XML)
          <input type="file" accept=".csv,.json,.xml" required onChange={(event) => setFile(event.target.files?.[0])} />
        </label>
        <button className="underline" disabled={!file || busy} type="submit">Ver vista previa</button>
      </form>
      {busy && <p role="status">Procesando lote…</p>}
      {error && <p role="alert">{error}</p>}
      {batch && <div className="grid gap-3">
        <p><b>{ESTADO_LOTE[batch.state] ?? batch.state.replace(/_/g, ' ')}</b> · {batch.counts.valid} listas · {batch.counts.repeated} ya importadas · {batch.counts.rejected} con error · {batch.counts.conflicts} en conflicto · {batch.counts.inserted} ventas nuevas guardadas</p>
        <div className="flex gap-4">
          {canConfirm && <button type="button" className="underline" disabled={busy}
            onClick={() => void run(() => ingestionApi.post<Batch>(`${base}/${batch.id}/confirm`, undefined, { timeout: 0 }).then(({ data }) => data), true)}>Confirmar o reanudar lote</button>}
          {batch.state === 'vista_previa' && <button type="button" className="underline" disabled={busy}
            onClick={() => void run(() => ingestionApi.delete<Batch>(`${base}/${batch.id}`).then(({ data }) => data))}>Descartar lote</button>}
        </div>
        {rows && <div className="grid gap-2">
          <table><thead><tr><th scope="col">Fila</th><th scope="col">Estado</th><th scope="col">Qué corregir</th></tr></thead>
            <tbody>{rows.data.map((row) => <tr key={row.row}><td>{row.row}</td><td>{ESTADO_FILA[row.status] ?? row.status}</td><td>{row.message}</td></tr>)}</tbody>
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
          {new Date(item.createdAt).toLocaleString('es-MX')} · {item.format.toUpperCase()} · {ESTADO_LOTE[item.state] ?? item.state.replace(/_/g, ' ')}
        </button>)}
        <div className="flex gap-4">
          <button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage(historyPage - 1)}>Lotes anteriores</button>
          <button type="button" disabled={historyPage * size >= history.total} onClick={() => setHistoryPage(historyPage + 1)}>Siguientes lotes</button>
        </div>
      </div>}
    </section>
  );
}
