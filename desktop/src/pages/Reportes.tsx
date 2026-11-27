import { useEffect, useState } from 'react';
import { FormatoReporte, Indicador, Reporte, exportarReporte, listarReportes, obtenerReporte } from '../api/documentsApi';
import { extractErrorMessage } from '../api/httpClient';
import BotonesExportar from '../components/BotonesExportar';
import { Columna, descargarBinario } from '../utils/exportar';

/*
 * Reportes ejecutivos (documents-service, M16). Los perfiles del escritorio listan, consultan y
 * descargan (PDF, Excel, CSV); generar es del Gerente de categoría, que no entra al escritorio.
 * D-20: un indicador no disponible sale con su motivo, nunca como 0. D-46: cada descarga la
 * registra el servicio en la bitácora.
 */

const COLUMNAS_INDICADORES: Columna<Indicador>[] = [
  { clave: 'clave', titulo: 'Clave', valor: (i) => i.clave },
  { clave: 'indicador', titulo: 'Indicador', valor: (i) => i.nombre },
  { clave: 'servicio', titulo: 'Servicio', valor: (i) => i.servicio },
  { clave: 'disponible', titulo: 'Disponible', valor: (i) => (i.disponible ? 'si' : 'no') },
  { clave: 'valor', titulo: 'Valor', valor: (i) => (i.disponible ? i.valor : null) },
  { clave: 'motivo', titulo: 'Motivo', valor: (i) => i.motivo },
];

const fechaHora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX');
};

export default function Reportes() {
  const [reportes, setReportes] = useState<Reporte[]>([]);
  const [detalle, setDetalle] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(true);
  const [descargando, setDescargando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listarReportes()
      .then((r) => setReportes(r.reportes))
      .catch((e) => setError(extractErrorMessage(e)))
      .finally(() => setCargando(false));
  }, []);

  async function abrir(id: string) {
    setError(null);
    try {
      setDetalle(await obtenerReporte(id));
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  async function exportar(r: Reporte, formato: FormatoReporte) {
    setError(null);
    setDescargando(`${r.id}-${formato}`);
    try {
      const archivo = await exportarReporte(r.id, formato);
      descargarBinario(archivo.nombre ?? `reporte-ejecutivo-${r.dateTo}.${formato}`, archivo.datos, archivo.tipo);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setDescargando(null);
    }
  }

  const botones = (r: Reporte) =>
    (['pdf', 'xlsx', 'csv'] as FormatoReporte[]).map((f) => (
      <button key={f} className="btn-secondary" disabled={descargando !== null} onClick={() => exportar(r, f)}>
        {descargando === `${r.id}-${f}` ? 'Descargando...' : f === 'xlsx' ? 'Excel' : f.toUpperCase()}
      </button>
    ));

  if (cargando) return <p>Cargando reportes...</p>;

  return (
    <div>
      <h1>Reportes ejecutivos</h1>
      <p className="muted">
        Servicio: documents-service. Los genera el Gerente de categoría; aquí se consultan y se descargan. Un indicador no
        disponible muestra su motivo, nunca 0 (D-20).
      </p>
      {error && <p className="alert-error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Creado</th>
              <th>Periodo</th>
              <th>Estado</th>
              <th>Indicadores disponibles</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reportes.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Todavía no hay reportes.
                </td>
              </tr>
            )}
            {reportes.map((r) => (
              <tr key={r.id}>
                <td>{fechaHora(r.creadoEn)}</td>
                <td>
                  {r.dateFrom} a {r.dateTo}
                </td>
                <td>{r.estado}</td>
                <td>
                  {r.secciones.filter((s) => s.disponible).length} de {r.secciones.length}
                </td>
                <td className="row-actions">
                  <button onClick={() => abrir(r.id)}>Ver</button>
                  {botones(r)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detalle && (
        <section className="panel">
          <h2>
            Reporte del {detalle.dateFrom} al {detalle.dateTo}
          </h2>
          <div className="toolbar">
            {botones(detalle)}
            <BotonesExportar
              nombreArchivo={`reporte-${detalle.id}-indicadores`}
              raizXml="indicadores"
              filaXml="indicador"
              columnas={COLUMNAS_INDICADORES}
              filas={detalle.secciones}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Indicador</th>
                  <th>Servicio</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {detalle.secciones.map((s) => (
                  <tr key={s.clave}>
                    <td>{s.nombre}</td>
                    <td>{s.servicio}</td>
                    <td>
                      {s.disponible ? (
                        s.valor ?? <span className="muted">sin datos en el periodo</span>
                      ) : (
                        <span className="muted">No disponible: {s.motivo ?? 'sin motivo'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
