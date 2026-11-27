import { FormEvent, useEffect, useState } from 'react';
import { RecomendacionResumen, explicarRecomendacion } from '../api/decisionApi';
import { extractErrorMessage } from '../api/httpClient';
import {
  ESTADOS_SEGUIMIENTO,
  EventoSeguimiento,
  NOMBRE_ENTREGA,
  NOMBRE_ESTADO_SEGUIMIENTO,
  NOMBRE_EVENTO,
  NOMBRE_METRICA,
  NOTA_MAX,
  NOTA_MIN,
  PASOS,
  Seguimiento as SeguimientoT,
  historialSeguimiento,
  indicePaso,
  iniciarSeguimiento,
  listarSeguimientos,
  marcarImplementada,
  mensajeConflictoSeguimiento,
  obtenerSeguimiento,
} from '../api/workflowApi';
import BotonesExportar from '../components/BotonesExportar';
import { accionesSeguimiento } from '../config/menu';
import { useAuth } from '../context/AuthContext';
import { Columna } from '../utils/exportar';
import Aviso from '../components/Aviso';
import { FilaVacia } from '../components/EstadosTabla';
import { Insignia, InsigniaSeguimiento, Tono } from '../components/Insignias';
import { Check, CheckCheck, Eye, ListChecks, Play, X } from 'lucide-react';

/*
 * Seguimiento de recomendaciones (recommendations-workflow-service, D-41). Los 3 perfiles leen.
 * SOLO el usuario asignado (id del token = assigneeUserId) inicia y marca implementada. Asignar y
 * evaluar son del Gerente de categoría desde la web: aquí la evaluación se muestra en solo lectura.
 */

const vacio = '—';
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-MX') : vacio);
const num = (n: number | null) => (n === null ? vacio : n.toLocaleString('es-MX', { maximumFractionDigits: 2 }));
const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const TONO_ENTREGA: Record<string, Tono> = { enviado: 'verde', fallido: 'rojo', pendiente: 'ambar', no_aplica: 'gris' };
const Entrega = ({ estado }: { estado: string }) => <Insignia tono={TONO_ENTREGA[estado] ?? 'gris'}>{NOMBRE_ENTREGA[estado] ?? estado}</Insignia>;

/** Línea de pasos: Asignada → En implementación → Implementada → Evaluada. */
function LineaPasos({ estado }: { estado: string }) {
  const actual = indicePaso(estado);
  return (
    <ol className="pasos" aria-label="Estado del seguimiento">
      {PASOS.map((p, i) => {
        // El último paso (evaluada) también cuenta como hecho: es el estado final.
        const hecho = i < actual || (i === actual && i === PASOS.length - 1);
        return (
          <li
            key={p.estado}
            className={hecho ? 'paso hecho' : i === actual ? 'paso actual' : 'paso'}
            aria-current={i === actual ? 'step' : undefined}
          >
            <span className="paso-circulo" aria-hidden="true">
              {hecho ? <Check size={16} strokeWidth={3} /> : i + 1}
            </span>
            {p.titulo}
          </li>
        );
      })}
    </ol>
  );
}

export default function Seguimiento() {
  const { usuario } = useAuth();
  const yo = usuario?.id ?? null;
  const quien = (id: string | null) => (!id ? vacio : yo && id.toLowerCase() === yo.toLowerCase() ? 'Tú' : id);

  const [estado, setEstado] = useState('');
  const [mios, setMios] = useState(false);
  const [lista, setLista] = useState<SeguimientoT[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [seleccion, setSeleccion] = useState<SeguimientoT | null>(null);
  const [recomendacion, setRecomendacion] = useState<RecomendacionResumen | null>(null);
  const [eventos, setEventos] = useState<EventoSeguimiento[]>([]);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const [nota, setNota] = useState('');
  const [implementadoEl, setImplementadoEl] = useState(hoy());
  const [moviendo, setMoviendo] = useState(false);

  const columnas: Columna<SeguimientoT>[] = [
    { clave: 'recomendacion', titulo: 'Recomendación', valor: (s) => s.recommendationId },
    { clave: 'estado', titulo: 'Estado', valor: (s) => NOMBRE_ESTADO_SEGUIMIENTO[s.status] ?? s.status },
    { clave: 'asignado', titulo: 'Asignado a', valor: (s) => quien(s.assigneeUserId) },
    { clave: 'asignada', titulo: 'Asignada', valor: (s) => s.assignedAt },
    { clave: 'compromiso', titulo: 'Fecha compromiso', valor: (s) => s.dueDate },
    { clave: 'implementada_el', titulo: 'Implementada el', valor: (s) => s.implementedOn },
    { clave: 'id', titulo: 'Id', valor: (s) => s.id },
  ];

  async function cargar(s = estado, m = mios) {
    try {
      setLista((await listarSeguimientos({ status: s || undefined, mine: m })).seguimientos);
      setError(null);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  useEffect(() => {
    cargar('', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function abrir(id: string) {
    setErrorDetalle(null);
    setAviso(null);
    setNota('');
    setImplementadoEl(hoy());
    try {
      const s = await obtenerSeguimiento(id);
      setSeleccion(s);
      setRecomendacion(null);
      explicarRecomendacion(s.recommendationId).then(setRecomendacion).catch(() => setRecomendacion(null));
      historialSeguimiento(id)
        .then((h) => setEventos(h.eventos))
        .catch((e) => setErrorDetalle(extractErrorMessage(e)));
    } catch (e) {
      setErrorDetalle(extractErrorMessage(e));
    }
  }

  async function mover(accion: () => Promise<SeguimientoT>, mensaje: string) {
    if (!seleccion) return;
    setMoviendo(true);
    setErrorDetalle(null);
    try {
      const s = await accion();
      setAviso(mensaje);
      await abrir(s.id);
      setAviso(mensaje);
      await cargar();
    } catch (e) {
      const conflicto = mensajeConflictoSeguimiento(e);
      await abrir(seleccion.id); // 409: se muestra el estado real
      setErrorDetalle(conflicto ?? extractErrorMessage(e));
      if (conflicto) await cargar();
    } finally {
      setMoviendo(false);
    }
  }

  function implementar(e: FormEvent) {
    e.preventDefault();
    if (!seleccion) return;
    const texto = nota.trim();
    if (texto.length < NOTA_MIN || texto.length > NOTA_MAX) {
      return setErrorDetalle(`Describe qué se hizo, entre ${NOTA_MIN} y ${NOTA_MAX} caracteres.`);
    }
    mover(
      () => marcarImplementada(seleccion.id, { implementedOn: implementadoEl || undefined, note: texto }),
      'Seguimiento marcado como implementado. El Gerente de categoría lo evaluará.',
    );
  }

  const acciones = seleccion ? accionesSeguimiento(yo, usuario?.rol, seleccion) : [];
  const ev = seleccion?.evaluation ?? null;

  return (
    <div>
      <h1>Seguimiento de recomendaciones</h1>
      <p className="muted">
        Servicios: recommendations-workflow-service (seguimiento e historial) y decision-service (qué dice la
        recomendación). El Gerente de categoría asigna y evalúa desde la web; aquí el responsable asignado inicia y
        marca implementado.
      </p>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="toolbar">
        <label htmlFor="filtro-estado-seguimiento" className="sr-only">
          Estado
        </label>
        <select
          id="filtro-estado-seguimiento"
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value);
            cargar(e.target.value, mios);
          }}
        >
          <option value="">Todos los estados</option>
          {ESTADOS_SEGUIMIENTO.map((s) => (
            <option key={s} value={s}>
              {NOMBRE_ESTADO_SEGUIMIENTO[s]}
            </option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={mios}
            onChange={(e) => {
              setMios(e.target.checked);
              cargar(estado, e.target.checked);
            }}
          />
          Mis seguimientos
        </label>
        <span className="toolbar-espacio" />
        <BotonesExportar nombreArchivo="seguimientos" raizXml="seguimientos" filaXml="seguimiento" columnas={columnas} filas={lista} />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Recomendación</th>
              <th>Estado</th>
              <th>Asignado a</th>
              <th>Asignada</th>
              <th>Compromiso</th>
              <th className="acciones">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && (
              <FilaVacia columnas={6} icono={ListChecks}>{mios ? 'No tienes seguimientos asignados.' : 'No hay seguimientos.'}</FilaVacia>
            )}
            {lista.map((s) => (
              <tr key={s.id}>
                <td>
                  <code>{s.recommendationId}</code>
                </td>
                <td>
                  <InsigniaSeguimiento estado={s.status} />
                </td>
                <td>{quien(s.assigneeUserId)}</td>
                <td>{fecha(s.assignedAt)}</td>
                <td>{s.dueDate ?? vacio}</td>
                <td className="acciones">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => abrir(s.id)}>
                    <Eye size={15} aria-hidden="true" />
                    Detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {errorDetalle && !seleccion && <Aviso tipo="error">{errorDetalle}</Aviso>}

      {seleccion && (
        <section className="panel">
          <div className="toolbar">
            <h2 style={{ margin: 0 }}>{recomendacion?.title || `Recomendación ${seleccion.recommendationId}`}</h2>
            <InsigniaSeguimiento estado={seleccion.status} />
            <button type="button" className="btn-ghost" onClick={() => setSeleccion(null)}>
              <X size={16} aria-hidden="true" />
              Cerrar
            </button>
          </div>
          <LineaPasos estado={seleccion.status} />
          {aviso && <Aviso tipo="exito">{aviso}</Aviso>}
          {errorDetalle && <Aviso tipo="error">{errorDetalle}</Aviso>}

          <dl className="detalle">
            {recomendacion && (
              <>
                <dt>Qué recomienda</dt>
                <dd>{recomendacion.whatRecommends}</dd>
                <dt>Por qué</dt>
                <dd>{recomendacion.why}</dd>
                <dt>Impacto estimado</dt>
                <dd>{recomendacion.estimatedImpact}</dd>
              </>
            )}
            <dt>Asignado a</dt>
            <dd>{quien(seleccion.assigneeUserId)}</dd>
            <dt>Asignó</dt>
            <dd>
              {quien(seleccion.assignedBy)} · {fecha(seleccion.assignedAt)}
            </dd>
            <dt>Fecha compromiso</dt>
            <dd>{seleccion.dueDate ?? vacio}</dd>
            {seleccion.assignmentNote && (
              <>
                <dt>Indicaciones</dt>
                <dd>{seleccion.assignmentNote}</dd>
              </>
            )}
            <dt>Iniciada</dt>
            <dd>{fecha(seleccion.startedAt)}</dd>
            <dt>Implementada</dt>
            <dd>
              {seleccion.implementedOn ?? vacio}
              {seleccion.implementationNote ? ` · ${seleccion.implementationNote}` : ''}
            </dd>
          </dl>

          {acciones.includes('iniciar') && (
            <div className="toolbar">
              <button type="button" disabled={moviendo} onClick={() => mover(() => iniciarSeguimiento(seleccion.id), 'Seguimiento iniciado.')}>
                <Play size={16} aria-hidden="true" />
                Iniciar
              </button>
            </div>
          )}
          {acciones.includes('implementar') && (
            <form className="panel form-grid" onSubmit={implementar}>
              <label>
                Implementada el
                <input type="date" value={implementadoEl} max={hoy()} onChange={(e) => setImplementadoEl(e.target.value)} />
              </label>
              <label className="wide">
                Qué se hizo ({NOTA_MIN} a {NOTA_MAX} caracteres)
                <textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={NOTA_MAX} rows={3} />
              </label>
              <div className="form-actions">
                <button type="submit" disabled={moviendo}>
                  <CheckCheck size={16} aria-hidden="true" />
                  Marcar implementada
                </button>
              </div>
            </form>
          )}
          {acciones.length === 0 && seleccion.status !== 'evaluada' && (
            <p className="muted">
              {seleccion.status === 'implementada'
                ? 'Falta la evaluación del Gerente de categoría (se hace desde la web).'
                : 'Solo el responsable asignado mueve este seguimiento.'}
            </p>
          )}

          {ev && (
            <>
              <h3>Evaluación (solo lectura)</h3>
              <dl className="detalle">
                <dt>Métrica</dt>
                <dd>
                  {NOMBRE_METRICA[ev.metric] ?? ev.metric} ({ev.unit})
                </dd>
                <dt>Antes</dt>
                <dd>
                  {ev.before.from} a {ev.before.to}: <strong>{num(ev.before.value)}</strong> {ev.unit}
                </dd>
                <dt>Después</dt>
                <dd>
                  {ev.after.from} a {ev.after.to}: <strong>{num(ev.after.value)}</strong> {ev.unit}
                </dd>
                <dt>Variación</dt>
                <dd>
                  <strong>{ev.variationPct === null ? vacio : `${num(ev.variationPct)} %`}</strong>
                </dd>
                <dt>Con qué datos</dt>
                <dd>{ev.source}</dd>
                {ev.comment && (
                  <>
                    <dt>Comentario</dt>
                    <dd>{ev.comment}</dd>
                  </>
                )}
                <dt>Evaluó</dt>
                <dd>
                  {quien(seleccion.evaluatedBy)} · {fecha(seleccion.evaluatedAt)}
                </dd>
              </dl>
            </>
          )}

          <h3>Historial</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Estado</th>
                  <th>Quién</th>
                  <th>Cuándo</th>
                  <th>Auditoría</th>
                  <th>Aviso</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e, i) => (
                  <tr key={`${e.event}-${i}`}>
                    <td>
                      <strong>{NOMBRE_EVENTO[e.event] ?? e.event}</strong>
                    </td>
                    <td>
                      {e.fromStatus ? `${NOMBRE_ESTADO_SEGUIMIENTO[e.fromStatus] ?? e.fromStatus} → ` : ''}
                      {NOMBRE_ESTADO_SEGUIMIENTO[e.toStatus] ?? e.toStatus}
                    </td>
                    <td>{quien(e.actorId)}</td>
                    <td>{fecha(e.at)}</td>
                    <td>
                      <Entrega estado={e.audit} />
                    </td>
                    <td>
                      <Entrega estado={e.notification} />
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
