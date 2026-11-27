import { FormEvent, useState } from 'react';
import { getZonas } from '../../api/catalogo';
import { mensajeDeError } from '../../api/errores';
import { listarRecomendaciones } from '../../api/recomendaciones';
import { listaSegura } from '../../api/seguro';
import {
  Asignable,
  asignarSeguimiento,
  EstadoSeguimiento,
  evaluarSeguimiento,
  getAsignables,
  getSeguimientos,
  Metrica,
  Seguimiento,
} from '../../api/seguimientos';
import { Cargando } from '../../components/Cargando';
import { EstadoError } from '../../components/EstadoError';
import { SectionHeader } from '../../components/SectionHeader';
import { CtaButton } from '../../components/ui/CtaButton';
import { ErrorText } from '../../components/ui/ErrorText';
import { StatusPill } from '../../components/ui/StatusPill';
import { useFetch } from '../../hooks/useFetch';
import { Producto, Zona } from '../../types';

const input =
  'h-11 rounded-full border-2 border-transparent bg-arena px-4 text-[14px] text-tinta outline-none focus:border-vino focus:bg-marfil disabled:opacity-50';
const etiqueta = 'flex flex-col gap-1 text-[13px] font-semibold text-teal';

const ESTADO: Record<EstadoSeguimiento, string> = {
  asignada: 'Asignada: el responsable aún no la inicia',
  en_implementacion: 'En implementación',
  implementada: 'Implementada: lista para evaluar',
  evaluada: 'Evaluada',
};

const METRICAS: { valor: Metrica; etiqueta: string; unidades: string[]; ayuda: string }[] = [
  { valor: 'ventas_unidades', etiqueta: 'Ventas en piezas', unidades: ['pza'], ayuda: 'Piezas vendidas en cada periodo.' },
  { valor: 'ventas_importe', etiqueta: 'Ventas en pesos', unidades: ['MXN'], ayuda: 'Importe vendido en cada periodo, en pesos.' },
  { valor: 'precio_unitario', etiqueta: 'Precio por unidad', unidades: ['MXN/kg', 'MXN/l', 'MXN/pza'], ayuda: 'Precio por kilo, litro o pieza de UNA presentación (no se mezclan presentaciones).' },
];

const hoy = () => new Date().toISOString().slice(0, 10);
const dias = (desde: string, hasta: string) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1;

/** Formulario de evaluación de un seguimiento implementado (D-41). */
function Evaluar({ s, zonas, productos, alTerminar }: { s: Seguimiento; zonas: Zona[]; productos: Producto[]; alTerminar: (m: string) => void }) {
  const [metrica, setMetrica] = useState<Metrica>('ventas_unidades');
  const [unidad, setUnidad] = useState('pza');
  const [zona, setZona] = useState('');
  const [presentacion, setPresentacion] = useState('');
  const [a, setA] = useState({ from: '', to: '', value: '' });
  const [d, setD] = useState({ from: '', to: '', value: '' });
  const [fuente, setFuente] = useState('');
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const def = METRICAS.find((m) => m.valor === metrica)!;
  const presentaciones = productos.flatMap((p) => (p.presentaciones ?? []).map((pr) => ({ id: pr.id, nombre: `${p.nombre} · ${pr.nombre}` })));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!zona && !presentacion) return setError('Indica dónde se midió: al menos la zona o la presentación.');
    if (metrica === 'precio_unitario' && !presentacion) return setError('El precio por unidad se mide sobre una presentación: elígela.');
    if (!a.from || !a.to || !d.from || !d.to) return setError('Completa las fechas de los dos periodos.');
    if (dias(a.from, a.to) !== dias(d.from, d.to)) return setError('Los dos periodos deben durar los mismos días para que la comparación sea justa.');
    if (!(Number(a.value) > 0)) return setError('El valor de «antes» debe ser mayor que cero (con 0 no hay variación que calcular).');
    if (fuente.trim().length < 3) return setError('Escribe de dónde salieron los datos (por ejemplo, el reporte o la consulta).');
    setEnviando(true);
    try {
      const r = await evaluarSeguimiento(s.id, {
        metric: metrica,
        unit: unidad,
        scope: { ...(zona ? { zoneId: zona } : {}), ...(presentacion ? { presentationId: presentacion } : {}) },
        before: { from: a.from, to: a.to, value: Number(a.value) },
        after: { from: d.from, to: d.to, value: Number(d.value) },
        source: fuente.trim(),
        ...(comentario.trim().length >= 10 ? { comment: comentario.trim() } : {}),
      });
      alTerminar(`Seguimiento evaluado: variación de ${r.evaluation?.variationPct ?? '—'} %.`);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo registrar la evaluación.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form noValidate onSubmit={enviar} className="mt-2 flex flex-col gap-3 rounded-[18px] bg-marfil p-4" data-testid="evaluar-seguimiento">
      <p className="text-xs text-teal/80">
        Compara un periodo <b>antes</b> de implementar con uno <b>después</b>, de la misma duración. El sistema calcula la variación.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className={etiqueta}>
          Qué mediste
          <select className={input} value={metrica} onChange={(e) => { const m = e.target.value as Metrica; setMetrica(m); setUnidad(METRICAS.find((x) => x.valor === m)!.unidades[0]); }}>
            {METRICAS.map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
          </select>
          <span className="text-[11px] font-normal text-teal/70">{def.ayuda}</span>
        </label>
        <label className={etiqueta}>
          Unidad
          <select className={input} value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            {def.unidades.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label className={etiqueta}>
          Zona donde se midió
          <select className={input} value={zona} onChange={(e) => setZona(e.target.value)}>
            <option value="">(sin zona)</option>
            {zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
          </select>
        </label>
        <label className={etiqueta}>
          Presentación{metrica === 'precio_unitario' ? ' (obligatoria)' : ' (opcional)'}
          <select className={input} value={presentacion} onChange={(e) => setPresentacion(e.target.value)}>
            <option value="">(ninguna)</option>
            {presentaciones.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
        <label className={etiqueta}>Antes: desde<input className={input} type="date" value={a.from} onChange={(e) => setA({ ...a, from: e.target.value })} /></label>
        <label className={etiqueta}>Antes: hasta<input className={input} type="date" value={a.to} onChange={(e) => setA({ ...a, to: e.target.value })} /></label>
        <label className={etiqueta}>Antes: valor<input className={input} type="number" min="0.01" step="0.01" placeholder="1000" value={a.value} onChange={(e) => setA({ ...a, value: e.target.value })} /></label>
        <label className={etiqueta}>Después: desde<input className={input} type="date" value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} /></label>
        <label className={etiqueta}>Después: hasta<input className={input} type="date" max={hoy()} value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} /></label>
        <label className={etiqueta}>Después: valor<input className={input} type="number" min="0" step="0.01" placeholder="1150" value={d.value} onChange={(e) => setD({ ...d, value: e.target.value })} /></label>
      </div>
      <label className={etiqueta}>
        De dónde salieron los datos
        <input className={input} placeholder="Reporte ejecutivo de noviembre, ventas de básicos en Zona Centro" value={fuente} maxLength={300} onChange={(e) => setFuente(e.target.value)} />
      </label>
      <label className={etiqueta}>
        Comentario (opcional)
        <input className={input} placeholder="Las ventas subieron después del ajuste de precio" value={comentario} maxLength={1000} onChange={(e) => setComentario(e.target.value)} />
      </label>
      {error && <ErrorText>{error}</ErrorText>}
      <div><CtaButton type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Registrar evaluación'}</CtaButton></div>
    </form>
  );
}

/**
 * D-41 — El Gerente asigna responsable a las recomendaciones que aprobó y evalúa su impacto
 * cuando el responsable las marca implementadas (eso lo hace en el escritorio).
 */
export function SeguimientosPanel({ productos }: { productos: Producto[] }) {
  const seguimientos = useFetch(getSeguimientos, []);
  const aceptadas = useFetch(() => listarRecomendaciones({ status: 'aceptada' }), []);
  const asignables = useFetch(getAsignables, []);
  const zonas = useFetch(getZonas, []);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eleccion, setEleccion] = useState<Record<string, { responsable: string; fecha: string; nota: string }>>({});
  const [evaluando, setEvaluando] = useState<string | null>(null);

  const lista = listaSegura<Seguimiento>(seguimientos.data);
  const conSeguimiento = new Set(lista.map((s) => s.recommendationId));
  const pendientes = listaSegura<{ id: string; title: string; whatRecommends: string }>(aceptadas.data).filter((r) => !conSeguimiento.has(r.id));
  const personas = listaSegura<Asignable>(asignables.data);
  const nombre = (id: string) => personas.find((p) => p.id === id)?.nombre ?? 'Responsable';
  const titulo = (id: string) => listaSegura<{ id: string; title: string }>(aceptadas.data).find((r) => r.id === id)?.title ?? 'Recomendación';

  async function asignar(recomendacionId: string) {
    setError(null);
    setAviso(null);
    const e = eleccion[recomendacionId];
    if (!e?.responsable) return setError('Elige a quién asignarla.');
    if (e.nota && e.nota.trim().length < 10) return setError('La nota, si la escribes, debe tener al menos 10 caracteres.');
    try {
      await asignarSeguimiento({
        recommendationId: recomendacionId,
        assigneeUserId: e.responsable,
        ...(e.fecha ? { dueDate: e.fecha } : {}),
        ...(e.nota?.trim() ? { note: e.nota.trim() } : {}),
      });
      setAviso(`Asignada a ${nombre(e.responsable)}. Le llegará un aviso para iniciarla.`);
      seguimientos.refetch();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo asignar.'));
    }
  }

  const cambiar = (id: string, campo: 'responsable' | 'fecha' | 'nota', valor: string) =>
    setEleccion((x) => ({ ...x, [id]: { ...(x[id] ?? { responsable: '', fecha: '', nota: '' }), [campo]: valor } }));

  return (
    <section className="flex flex-col gap-6" data-testid="panel-seguimientos">
      <SectionHeader
        title="Seguimiento de recomendaciones"
        description="Asigna un responsable a cada recomendación que aprobaste y, cuando esté implementada, registra su impacto (D-41)."
      />
      {error && <div className="px-6"><ErrorText>{error}</ErrorText></div>}
      {aviso && <p role="status" className="mx-6 rounded-full bg-salvia/20 px-4 py-2 text-sm text-tinta">{aviso}</p>}

      <div className="flex flex-col gap-3 px-6">
        <h2 className="font-display text-2xl text-vino">Por asignar</h2>
        {(aceptadas.loading || asignables.loading) && <Cargando etiqueta="Cargando recomendaciones aprobadas…" />}
        {aceptadas.error && <EstadoError mensaje={aceptadas.error} onReintentar={aceptadas.refetch} />}
        {asignables.error && <EstadoError mensaje={asignables.error} onReintentar={asignables.refetch} />}
        {aceptadas.data && pendientes.length === 0 && <p className="text-sm text-teal/70">No hay recomendaciones aprobadas sin responsable.</p>}
        {pendientes.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-[22px] bg-arena p-4" data-recomendacion={r.id}>
            <span className="font-semibold text-tinta">{r.title}</span>
            <span className="text-xs text-teal/80">{r.whatRecommends}</span>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className={etiqueta}>
                Responsable
                <select className={input} value={eleccion[r.id]?.responsable ?? ''} onChange={(e) => cambiar(r.id, 'responsable', e.target.value)}>
                  <option value="">Elige…</option>
                  {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.rol}</option>)}
                </select>
              </label>
              <label className={etiqueta}>
                Fecha compromiso (opcional)
                <input className={input} type="date" min={hoy()} value={eleccion[r.id]?.fecha ?? ''} onChange={(e) => cambiar(r.id, 'fecha', e.target.value)} />
              </label>
              <label className={etiqueta}>
                Nota (opcional)
                <input className={input} placeholder="Aplicar el ajuste de precio en Zona Centro" value={eleccion[r.id]?.nota ?? ''} onChange={(e) => cambiar(r.id, 'nota', e.target.value)} />
              </label>
            </div>
            <div><CtaButton onClick={() => asignar(r.id)}>Asignar</CtaButton></div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 px-6">
        <h2 className="font-display text-2xl text-vino">Seguimientos</h2>
        {seguimientos.loading && !seguimientos.data && <Cargando etiqueta="Cargando seguimientos…" />}
        {seguimientos.error && <EstadoError mensaje={seguimientos.error} onReintentar={seguimientos.reintentable ? seguimientos.refetch : undefined} />}
        {seguimientos.data && lista.length === 0 && <p className="text-sm text-teal/70">Todavía no hay seguimientos.</p>}
        {lista.map((s) => (
          <div key={s.id} className="flex flex-col gap-1 rounded-[22px] bg-arena p-4" data-seguimiento={s.id} data-estado={s.status}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-tinta">{titulo(s.recommendationId)}</span>
              <StatusPill tone={s.status === 'evaluada' ? 'ok' : s.status === 'implementada' ? 'warn' : 'neutral'}>{ESTADO[s.status]}</StatusPill>
            </div>
            <span className="text-xs text-teal/80">
              Responsable: {nombre(s.assigneeUserId)}{s.dueDate ? ` · compromiso ${s.dueDate}` : ''}
              {s.evaluation ? ` · variación ${s.evaluation.variationPct} % (${s.evaluation.metric.replace('_', ' ')})` : ''}
            </span>
            {s.status === 'implementada' && evaluando !== s.id && (
              <div><CtaButton onClick={() => setEvaluando(s.id)}>Evaluar impacto</CtaButton></div>
            )}
            {evaluando === s.id && (
              <Evaluar
                s={s}
                zonas={listaSegura<Zona>(zonas.data)}
                productos={productos}
                alTerminar={(m) => { setEvaluando(null); setAviso(m); seguimientos.refetch(); }}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
