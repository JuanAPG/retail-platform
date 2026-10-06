import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { getRun, listRuns, runApriori } from '../api/algorithmsApi';
import { Rule, Run, RunDetail } from '../api/algorithmsParsers';
import { listZones } from '../api/catalogApi';
import { Zone } from '../api/catalogParsers';
import { extractErrorMessage } from '../api/httpClient';
import { puedeEscribir } from '../config/menu';
import { useAuth } from '../context/AuthContext';

const vacio = '—';

function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

const fechaHora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX');
};

export default function Asociacion() {
  const { usuario } = useAuth();
  const puedeEjecutar = puedeEscribir(usuario?.rol ?? null);

  const [minSupport, setMinSupport] = useState('0.2');
  const [minConfidence, setMinConfidence] = useState('0.5');
  const [maxItemsetSize, setMaxItemsetSize] = useState('3');
  const [zoneId, setZoneId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [zonas, setZonas] = useState<Zone[]>([]);
  const [ejecutando, setEjecutando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);

  const [corridas, setCorridas] = useState<Run[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<RunDetail | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [soloLiftPositivo, setSoloLiftPositivo] = useState(false);

  const cargarCorridas = useCallback(async () => {
    try {
      setCorridas((await listRuns(1, 50)).runs);
      setErrorLista(null);
    } catch (e) {
      setErrorLista(extractErrorMessage(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargarCorridas();
    listZones()
      .then(setZonas)
      .catch(() => setZonas([]));
  }, [cargarCorridas]);

  async function abrirCorrida(id: string) {
    setAbriendo(true);
    setErrorLista(null);
    try {
      setDetalle(await getRun(id));
      setBusqueda('');
      setSoloLiftPositivo(false);
    } catch (e) {
      setErrorLista(extractErrorMessage(e));
    } finally {
      setAbriendo(false);
    }
  }

  function validar(): string | null {
    const s = Number(minSupport);
    const c = Number(minConfidence);
    if (minSupport.trim() === '' || Number.isNaN(s) || s < 0.01 || s > 1)
      return 'El soporte mínimo debe ser un número entre 0.01 y 1.';
    if (minConfidence.trim() === '' || Number.isNaN(c) || c < 0 || c > 1)
      return 'La confianza mínima debe ser un número entre 0 y 1.';
    if (dateFrom && dateTo && dateFrom > dateTo) return 'La fecha inicial no puede ser posterior a la final.';
    return null;
  }

  async function ejecutar(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    const problema = validar();
    if (problema) {
      setErrorForm(problema);
      return;
    }
    setErrorForm(null);
    setEjecutando(true);
    try {
      const reglas = await runApriori({
        minSupport: Number(minSupport),
        minConfidence: Number(minConfidence),
        maxItemsetSize: Number(maxItemsetSize),
        zoneId: zoneId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      await cargarCorridas();
      if (reglas.length > 0) {
        await abrirCorrida(reglas[0].runId);
      } else {
        setDetalle(null);
        setAviso('La corrida terminó, pero ninguna regla cumplió los umbrales. Prueba con valores más bajos.');
      }
    } catch (err) {
      setErrorForm(extractErrorMessage(err));
      cargarCorridas();
    } finally {
      setEjecutando(false);
    }
  }

  const reglasVisibles: Rule[] = useMemo(() => {
    if (!detalle) return [];
    const q = normalizar(busqueda.trim());
    return detalle.results.filter((r) => {
      if (soloLiftPositivo && !(r.lift !== null && r.lift > 1)) return false;
      if (!q) return true;
      return normalizar([...r.antecedente, ...r.consecuente].join(' ')).includes(q);
    });
  }, [detalle, busqueda, soloLiftPositivo]);

  const nombreZona = (id: string) => zonas.find((z) => z.id === id)?.nombre ?? id;

  return (
    <div>
      <h1>Reglas de asociación</h1>
      <p className="muted">
        Descubre qué productos se compran juntos (algoritmo Apriori). Cada ejecución queda guardada como una corrida.
      </p>

      {puedeEjecutar ? (
        <form className="panel form-grid" onSubmit={ejecutar}>
          <label>
            Soporte mínimo (0.01 – 1)
            <input value={minSupport} onChange={(e) => setMinSupport(e.target.value)} inputMode="decimal" />
          </label>
          <label>
            Confianza mínima (0 – 1)
            <input value={minConfidence} onChange={(e) => setMinConfidence(e.target.value)} inputMode="decimal" />
          </label>
          <label>
            Tamaño máximo del conjunto
            <select value={maxItemsetSize} onChange={(e) => setMaxItemsetSize(e.target.value)}>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </select>
          </label>
          <label>
            Zona (opcional)
            <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <option value="">Todas las zonas</option>
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            Desde (opcional)
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label>
            Hasta (opcional)
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={ejecutando}>
              {ejecutando ? 'Ejecutando...' : 'Ejecutar Apriori'}
            </button>
          </div>
        </form>
      ) : (
        <p className="alert-info">
          Tu rol ({usuario?.rol}) puede consultar las corridas, pero solo Administrador y Analista comercial pueden
          ejecutarlas.
        </p>
      )}

      {errorForm && <p className="alert-error">{errorForm}</p>}
      {aviso && <p className="alert-info">{aviso}</p>}

      {abriendo && <p>Cargando corrida...</p>}

      {detalle && (
        <section>
          <h2>Corrida del {fechaHora(detalle.date)}</h2>
          {detalle.status === 'fallida' && (
            <p className="alert-error">La corrida falló: {detalle.errorMessage ?? 'sin detalle'}</p>
          )}
          <p className="muted">
            Periodo de los datos: {detalle.periodStart ?? vacio} a {detalle.periodEnd ?? vacio} · Canastas analizadas:{' '}
            {detalle.basketsConsidered ?? vacio} · Ejecutó: {detalle.userName ?? vacio}
          </p>
          <p className="muted">
            Parámetros:{' '}
            {Object.entries(detalle.parameters)
              .map(([k, v]) => `${k} = ${v}`)
              .join(' · ')}
          </p>
          {detalle.filters.length > 0 && (
            <p className="muted">
              Filtros:{' '}
              {detalle.filters
                .map((f) => `${f.dimension}: ${f.dimension === 'zona' ? nombreZona(f.referenceId) : f.referenceId}`)
                .join(' · ')}
            </p>
          )}
          {detalle.assumptions.length > 0 && (
            <details>
              <summary>Supuestos de la corrida ({detalle.assumptions.length})</summary>
              <ul>
                {detalle.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="toolbar">
            <input
              type="search"
              placeholder="Buscar por producto"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={soloLiftPositivo}
                onChange={(e) => setSoloLiftPositivo(e.target.checked)}
              />
              Solo asociación positiva (lift &gt; 1)
            </label>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Si compra…</th>
                  <th>…también compra</th>
                  <th>Soporte</th>
                  <th>Confianza</th>
                  <th>Lift</th>
                  <th>Canastas</th>
                </tr>
              </thead>
              <tbody>
                {reglasVisibles.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      {detalle.results.length === 0 ? 'Esta corrida no generó reglas.' : 'Ninguna regla coincide.'}
                    </td>
                  </tr>
                )}
                {reglasVisibles.map((r) => (
                  <tr key={r.id}>
                    <td>{r.antecedente.join(', ')}</td>
                    <td>{r.consecuente.join(', ')}</td>
                    <td>{(r.support * 100).toFixed(1)}%</td>
                    <td>{(r.confidence * 100).toFixed(1)}%</td>
                    <td>{r.lift === null ? vacio : r.lift.toFixed(2)}</td>
                    <td>{r.transactionCount ?? vacio}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            {reglasVisibles.length} de {detalle.results.length} reglas
          </p>
        </section>
      )}

      <h2>Historial de corridas</h2>
      {errorLista && <p className="alert-error">{errorLista}</p>}
      {cargando ? (
        <p>Cargando corridas...</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Soporte / Confianza</th>
                <th>Canastas</th>
                <th>Ejecutó</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {corridas.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Todavía no hay corridas.
                  </td>
                </tr>
              )}
              {corridas.map((c) => (
                <tr key={c.id}>
                  <td>{fechaHora(c.date)}</td>
                  <td>{c.status === 'completada' ? 'Completada' : 'Fallida'}</td>
                  <td>
                    {c.parameters.soporte_minimo ?? vacio} / {c.parameters.confianza_minima ?? vacio}
                  </td>
                  <td>{c.basketsConsidered ?? vacio}</td>
                  <td>{c.userName ?? vacio}</td>
                  <td>
                    <button onClick={() => abrirCorrida(c.id)} disabled={abriendo}>
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}