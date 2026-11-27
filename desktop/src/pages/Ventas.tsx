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
import Aviso from '../components/Aviso';
import { FilaVacia } from '../components/EstadosTabla';
import { Insignia, Tono } from '../components/Insignias';
import { Check, Download, Eye, Trash2, Upload } from 'lucide-react';

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

const TONO_FILA: Record<string, Tono> = { valida: 'verde', repetida: 'gris', rechazada: 'rojo', conflicto: 'ambar' };
const TONO_LOTE: Record<string, Tono> = {
  vista_previa: 'azul',
  confirmando: 'azul',
  conciliacion: 'ambar',
  confirmado: 'verde',
  descartado: 'gris',
};

const fechaHora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX');
};

function Conteos({ lote }: { lote: LoteImportacion }) {
  const c = lote.counts;
  return (
    <div className="metricas">
      {[
        [c.valid, 'Válidas'],
        [c.repeated, 'Repetidas'],
        [c.rejected, 'Rechazadas'],
        [c.conflicts, 'En conflicto'],
        [c.inserted, 'Ventas nuevas'],
      ].map(([valor, etiqueta]) => (
        <div className="metrica" key={etiqueta}>
          <strong>{Number(valor).toLocaleString('es-MX')}</strong>
          <span>{etiqueta}</span>
        </div>
      ))}
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
    return <Aviso tipo="info">Solo el Analista comercial importa ventas (D-31).</Aviso>;
  }

  return (
    <div>
      <h1>Importar ventas</h1>
      <p className="muted">
        Servicio: transactions-ingestion-service. Una venta se identifica por tienda
        y folio (D-34): reimportar no duplica, y el mismo folio con otro contenido queda en conflicto.
      </p>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {aviso && <Aviso tipo="exito">{aviso}</Aviso>}

      <div className="dos-columnas">
        <form className="panel" onSubmit={enviarArchivo}>
          <h2>1. Archivo de ventas (adjunto)</h2>
          <p className="muted">
            Los datos: CSV (coma o punto y coma), JSON o XML <code>salesFile</code>. Máximo 8 MB. Columnas: folio, fecha,
            tienda, sku, presentación, cantidad y precio.
          </p>
          <label>
            Archivo (.csv, .json o .xml)
            <input type="file" accept=".csv,.json,.xml" onChange={elegirArchivo} />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={trabajando || !archivo}>
              <Upload size={16} aria-hidden="true" />
              {trabajando ? 'Enviando…' : 'Subir y ver vista previa'}
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
              <Download size={16} aria-hidden="true" />
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
            Lote {lote.id} <Insignia tono={TONO_LOTE[lote.state] ?? 'gris'}>{NOMBRE_ESTADO_LOTE[lote.state] ?? lote.state}</Insignia>
          </h2>
          <p className="muted">
            Formato {lote.format} · {lote.sizeBytes} bytes · SHA-256 {lote.sha256.slice(0, 16)}… · creado{' '}
            {fechaHora(lote.createdAt)}
          </p>
          <Conteos lote={lote} />
          {lote.state === 'conciliacion' && (
            <Aviso tipo="info">
              El lote tiene filas en conflicto y requiere revisión. Cómo se resuelve la conciliación no está definido en el
              contrato (pendiente).
            </Aviso>
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
              <Check size={16} aria-hidden="true" />
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
              <Trash2 size={16} aria-hidden="true" />
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
                  <th className="num">Fila</th>
                  <th>Estado</th>
                  <th>Código</th>
                  <th>Mensaje</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <FilaVacia columnas={4}>{soloProblemas ? 'Ninguna fila con error o conflicto.' : 'El lote no tiene filas.'}</FilaVacia>
                )}
                {visibles.map((f) => (
                  <tr key={f.row}>
                    <td className="num">{f.row}</td>
                    <td>
                      <Insignia tono={TONO_FILA[f.status] ?? 'gris'}>{NOMBRE_ESTADO_FILA[f.status] ?? f.status}</Insignia>
                    </td>
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
        <select aria-label="Estado del lote" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
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
              <th className="num">Válidas / rechazadas / conflictos</th>
              <th className="num">Ventas nuevas</th>
              <th className="acciones">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {historial.length === 0 && (
              <FilaVacia columnas={6}>Todavía no hay lotes.</FilaVacia>
            )}
            {historial.map((l) => (
              <tr key={l.id}>
                <td>{fechaHora(l.createdAt)}</td>
                <td>
                  <Insignia tono={TONO_LOTE[l.state] ?? 'gris'}>{NOMBRE_ESTADO_LOTE[l.state] ?? l.state}</Insignia>
                </td>
                <td>{l.format.toUpperCase()}</td>
                <td className="num">
                  {l.counts.valid.toLocaleString('es-MX')} / {l.counts.rejected.toLocaleString('es-MX')} /{' '}
                  {l.counts.conflicts.toLocaleString('es-MX')}
                </td>
                <td className="num">{l.counts.inserted.toLocaleString('es-MX')}</td>
                <td className="acciones">
                  <button className="btn-secondary btn-sm" onClick={() => abrirLote(l)}>
                    <Eye size={15} aria-hidden="true" />
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
