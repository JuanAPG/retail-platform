import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { extractErrorMessage } from '../api/httpClient';
import {
  FilaImportacion,
  LoteImportacion,
  NOMBRE_ESTADO_LOTE,
  archivoVentasXml,
  confirmarLote,
  descartarLote,
  filasDelLote,
  importarDesdeObjeto,
  listarLotes,
  obtenerLote,
  revisarArchivo,
  subirArchivo,
} from '../api/ingestionApi';
import { NAMESPACE, construirXml } from '../api/xml';
import BotonesExportar from '../components/BotonesExportar';
import { puede } from '../config/menu';
import { useAuth } from '../context/AuthContext';
import { Columna, descargar } from '../utils/exportar';

/*
 * Importar ventas (transactions-ingestion-service, 3111, D-33/D-34; contrato en
 * docs/contratos/transactions-ingestion-service.md). Solo el Analista comercial. Se separan:
 *  - el ARCHIVO de ventas (los datos: CSV, JSON o XML `salesFile`), que viaja adjunto;
 *  - el MENSAJE de control (`objectImport` en XML para importar desde el bucket privado;
 *    confirmar y descartar), que le dice al servicio qué hacer con un lote.
 * La vista previa no crea ventas. Confirmar es idempotente: repetirlo no duplica (D-34).
 */

const COLUMNAS_FILAS: Columna<FilaImportacion>[] = [
  { clave: 'fila', titulo: 'Fila', valor: (f) => f.row },
  { clave: 'estado', titulo: 'Estado', valor: (f) => f.status },
  { clave: 'codigo', titulo: 'Código', valor: (f) => f.code },
  { clave: 'mensaje', titulo: 'Mensaje', valor: (f) => f.message },
];

const NOMBRE_ESTADO_FILA: Record<string, string> = {
  valida: 'Válida',
  repetida: 'Repetida (ya existía igual)',
  rechazada: 'Rechazada',
  conflicto: 'Conflicto (misma tienda y folio, otro contenido)',
};

const fechaHora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX');
};

function Conteos({ lote }: { lote: LoteImportacion }) {
  const c = lote.counts;
  return (
    <div className="cards">
      <div className="card">
        <h3>{c.valid}</h3>
        <p>Válidas</p>
      </div>
      <div className="card">
        <h3>{c.repeated}</h3>
        <p>Repetidas</p>
      </div>
      <div className="card">
        <h3>{c.rejected}</h3>
        <p>Rechazadas</p>
      </div>
      <div className="card">
        <h3>{c.conflicts}</h3>
        <p>En conflicto</p>
      </div>
      <div className="card">
        <h3>{c.inserted}</h3>
        <p>Ventas nuevas</p>
      </div>
    </div>
  );
}

export default function Ventas() {
  const { usuario } = useAuth();
  const puedeImportar = puede(usuario?.rol, 'importarVentas');

  const [archivo, setArchivo] = useState<File | null>(null);
  const [objectKey, setObjectKey] = useState('');
  const [generation, setGeneration] = useState('');

  const [lote, setLote] = useState<LoteImportacion | null>(null);
  const [filas, setFilas] = useState<FilaImportacion[]>([]);
  const [totalFilas, setTotalFilas] = useState(0);
  const [soloProblemas, setSoloProblemas] = useState(true);

  const [historial, setHistorial] = useState<LoteImportacion[]>([]);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargarHistorial = useCallback(async () => {
    try {
      setHistorial((await listarLotes(1, 50, filtroEstado || undefined)).lotes);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }, [filtroEstado]);

  useEffect(() => {
    cargarHistorial();
  }, [cargarHistorial]);

  async function abrirLote(l: LoteImportacion) {
    setError(null);
    setAviso(null);
    try {
      const [resumen, pagina] = await Promise.all([obtenerLote(l.id), filasDelLote(l.id)]);
      setLote(resumen);
      setFilas(pagina.filas);
      setTotalFilas(pagina.total);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  async function trabajar(accion: () => Promise<LoteImportacion>, mensaje: (l: LoteImportacion) => string) {
    setError(null);
    setAviso(null);
    setTrabajando(true);
    try {
      const l = await accion();
      await abrirLote(l);
      setAviso(mensaje(l));
      await cargarHistorial();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setTrabajando(false);
    }
  }

  function elegirArchivo(e: ChangeEvent<HTMLInputElement>) {
    setArchivo(e.target.files?.[0] ?? null);
    setError(null);
  }

  async function enviarArchivo(e: FormEvent) {
    e.preventDefault();
    if (!archivo) return setError('Elige un archivo de ventas.');
    const problema = await revisarArchivo(archivo);
    if (problema) return setError(problema);
    await trabajar(
      () => subirArchivo(archivo),
      (l) => `Vista previa lista (${l.format}). Todavía no se creó ninguna venta: revisa las filas y confirma.`,
    );
  }

  async function enviarMensaje(e: FormEvent) {
    e.preventDefault();
    if (!objectKey.trim()) return setError('Escribe la clave del objeto (objectKey).');
    if (!/^[0-9]+$/.test(generation.trim())) return setError('La generación es un número (viaja como texto).');
    await trabajar(
      () => importarDesdeObjeto(objectKey.trim(), generation.trim()),
      () => 'Vista previa lista desde el bucket. Todavía no se creó ninguna venta.',
    );
  }

  const mensajeXml = construirXml('objectImport', NAMESPACE.ingestion, {
    objectKey: objectKey.trim() || 'ingestion/incoming/…',
    generation: generation.trim() || '0',
  });

  const visibles = soloProblemas ? filas.filter((f) => f.status === 'rechazada' || f.status === 'conflicto') : filas;
  const puedeConfirmar = lote && (lote.state === 'vista_previa' || lote.state === 'confirmando');
  const puedeDescartar = lote && lote.state === 'vista_previa';

  if (!puedeImportar) {
    return <p className="alert-info">Solo el Analista comercial importa ventas (D-31).</p>;
  }

  return (
    <div>
      <h1>Importar ventas</h1>
      <p className="muted">
        Servicio: transactions-ingestion-service. Una venta se identifica por tienda
        y folio (D-34): reimportar no duplica, y el mismo folio con otro contenido queda en conflicto.
      </p>
      {error && <p className="alert-error">{error}</p>}
      {aviso && <p className="alert-info">{aviso}</p>}

      <div className="dos-columnas">
        <form className="panel" onSubmit={enviarArchivo}>
          <h2>1. Archivo de ventas (adjunto)</h2>
          <p className="muted">
            Los datos: CSV (coma o punto y coma), JSON o XML <code>salesFile</code>. Máximo 8 MB. Columnas: folio, fecha,
            tienda, sku, presentación, cantidad y precio.
          </p>
          <input type="file" accept=".csv,.json,.xml" onChange={elegirArchivo} />
          <div className="form-actions">
            <button type="submit" disabled={trabajando || !archivo}>
              {trabajando ? 'Enviando...' : 'Subir y ver vista previa'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                descargar(
                  'plantilla-ventas.xml',
                  archivoVentasXml([
                    { folio: 'DEMO-001', fecha: '2026-11-20', tienda: 'MTY-CENTRO', sku: 'SKU-100', presentacion: '500 g', cantidad: 2, precio: 42.5 },
                  ]),
                  'application/xml',
                )
              }
            >
              Descargar plantilla XML
            </button>
          </div>
        </form>

        <form className="panel" onSubmit={enviarMensaje}>
          <h2>2. Mensaje de control (desde el bucket)</h2>
          <p className="muted">
            No lleva datos: le dice al servicio que importe un objeto ya subido al bucket privado. Viaja como XML{' '}
            <code>objectImport</code>.
          </p>
          <label>
            Clave del objeto
            <input value={objectKey} onChange={(e) => setObjectKey(e.target.value)} placeholder="ingestion/incoming/01/demo.csv" />
          </label>
          <label>
            Generación
            <input value={generation} onChange={(e) => setGeneration(e.target.value)} inputMode="numeric" />
          </label>
          <details>
            <summary>XML que se envía</summary>
            <pre>{mensajeXml}</pre>
          </details>
          <div className="form-actions">
            <button type="submit" disabled={trabajando}>
              Importar desde el bucket
            </button>
          </div>
        </form>
      </div>

      {lote && (
        <section className="panel">
          <h2>
            Lote {lote.id} · {NOMBRE_ESTADO_LOTE[lote.state] ?? lote.state}
          </h2>
          <p className="muted">
            Formato {lote.format} · {lote.sizeBytes} bytes · SHA-256 {lote.sha256.slice(0, 16)}… · creado{' '}
            {fechaHora(lote.createdAt)}
          </p>
          <Conteos lote={lote} />
          {lote.state === 'conciliacion' && (
            <p className="alert-info">
              El lote tiene filas en conflicto y requiere revisión. Cómo se resuelve la conciliación no está definido en el
              contrato (pendiente).
            </p>
          )}
          <div className="toolbar">
            <button
              disabled={!puedeConfirmar || trabajando}
              onClick={() =>
                trabajar(
                  () => confirmarLote(lote.id),
                  (l) => `Lote ${NOMBRE_ESTADO_LOTE[l.state] ?? l.state}: ${l.counts.inserted} ventas nuevas. Confirmar otra vez no duplica.`,
                )
              }
            >
              Confirmar importación
            </button>
            <button
              className="btn-danger"
              disabled={!puedeDescartar || trabajando}
              onClick={() => {
                if (window.confirm('¿Descartar este lote? No se creará ninguna venta.')) {
                  trabajar(
                    () => descartarLote(lote.id),
                    () => 'Lote descartado.',
                  );
                }
              }}
            >
              Descartar
            </button>
            <label className="check">
              <input type="checkbox" checked={soloProblemas} onChange={(e) => setSoloProblemas(e.target.checked)} />
              Solo filas con error o conflicto
            </label>
            <BotonesExportar
              nombreArchivo={`lote-${lote.id}-filas`}
              raizXml="filasImportacion"
              filaXml="fila"
              columnas={COLUMNAS_FILAS}
              filas={visibles}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Estado</th>
                  <th>Código</th>
                  <th>Mensaje</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {soloProblemas ? 'Ninguna fila con error o conflicto.' : 'El lote no tiene filas.'}
                    </td>
                  </tr>
                )}
                {visibles.map((f) => (
                  <tr key={f.row}>
                    <td>{f.row}</td>
                    <td>{NOMBRE_ESTADO_FILA[f.status] ?? f.status}</td>
                    <td>{f.code ?? '—'}</td>
                    <td>{f.message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            {filas.length} de {totalFilas} filas cargadas (la fila 1 es la primera de datos).
          </p>
        </section>
      )}

      <h2>Historial de lotes</h2>
      <div className="toolbar">
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(NOMBRE_ESTADO_LOTE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Creado</th>
              <th>Estado</th>
              <th>Formato</th>
              <th>Válidas / rechazadas / conflictos</th>
              <th>Ventas nuevas</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {historial.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Todavía no hay lotes.
                </td>
              </tr>
            )}
            {historial.map((l) => (
              <tr key={l.id}>
                <td>{fechaHora(l.createdAt)}</td>
                <td>{NOMBRE_ESTADO_LOTE[l.state] ?? l.state}</td>
                <td>{l.format}</td>
                <td>
                  {l.counts.valid} / {l.counts.rejected} / {l.counts.conflicts}
                </td>
                <td>{l.counts.inserted}</td>
                <td>
                  <button className="btn-secondary" onClick={() => abrirLote(l)}>
                    Ver
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
