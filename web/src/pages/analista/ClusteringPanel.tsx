import { FormEvent, useState } from 'react';
import type Highcharts from 'highcharts';
import { useAuth } from '../../context/AuthContext';
import { useFetch } from '../../hooks/useFetch';
import { SectionHeader } from '../../components/SectionHeader';
import { Grafica } from '../../components/Grafica';
import { SelectorTipoGrafica } from '../../components/SelectorTipoGrafica';
import { Cargando } from '../../components/Cargando';
import { EstadoError } from '../../components/EstadoError';
import { COLORES } from '../../components/coloresGrafica';
import { ErrorText } from '../../components/ui/ErrorText';
import { mensajeDeError } from '../../api/errores';
import { listaSegura } from '../../api/seguro';
import {
  CorridaClustering,
  correrClustering,
  getCorridaClustering,
  getCorridasClustering,
  IndicadorZona,
} from '../../api/estadistica';

const INDICADORES: Record<IndicadorZona, { nombre: string; formato: (n: number) => string }> = {
  estimatedIncome: { nombre: 'Ingreso estimado', formato: (n) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }) },
  population: { nombre: 'Población', formato: (n) => n.toLocaleString('es-MX', { maximumFractionDigits: 0 }) },
  availability: { nombre: 'Disponibilidad de básicos', formato: (n) => `${(n * 100).toLocaleString('es-MX', { maximumFractionDigits: 0 })} %` },
  averageTicket: { nombre: 'Ticket promedio', formato: (n) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) },
};
const TODOS: IndicadorZona[] = ['estimatedIncome', 'population', 'availability', 'averageTicket'];
const COLORES_GRUPO = [COLORES.vino, COLORES.teal, COLORES.salvia, '#B8A98A', '#4F6F68', '#A66A5B', '#7E8F5A', '#C58B3C', '#5B7FA6', '#8A5FA3'];

const inputClass =
  'h-12 rounded-full border-2 border-transparent bg-marfil px-4 text-[14px] text-tinta outline-none transition focus:border-vino hover:border-salvia/60 disabled:opacity-50';
const labelClass = 'flex flex-col gap-1.5 text-[13px] font-semibold text-teal';

function fechaHora(iso: string): string {
  const f = new Date(iso);
  return Number.isNaN(f.getTime()) ? '—' : new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(f);
}

/**
 * RF-16 — Agrupa ZONAS (nunca personas) con KMeans sobre sus indicadores estandarizados. Cada corrida se
 * guarda completa (MongoDB, D3) y se puede reabrir. La corrida PROPONE grupos: no cambia la clasificación
 * de ninguna zona. Límite del Parcial 2 (D-27): k debe ser menor al número de zonas con datos.
 */
export function ClusteringPanel() {
  const { usuario } = useAuth();
  const puedeCorrer = usuario?.rol === 'Analista comercial';
  const historial = useFetch(() => getCorridasClustering({ limit: 20 }), []);

  const [k, setK] = useState('2');
  const [semilla, setSemilla] = useState('42');
  const [indicadores, setIndicadores] = useState<IndicadorZona[]>(TODOS);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corrida, setCorrida] = useState<CorridaClustering | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [tipo, setTipo] = useState<'dispersion' | 'perfil' | 'tamano'>('dispersion');
  const [ejeX, setEjeX] = useState<IndicadorZona | ''>('');
  const [ejeY, setEjeY] = useState<IndicadorZona | ''>('');

  const filas = listaSegura<CorridaClustering>(historial.data?.data);

  function alternar(i: IndicadorZona) {
    setIndicadores((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
  }

  async function correr(e: FormEvent) {
    e.preventDefault();
    if (corriendo) return;
    setError(null);
    const kn = Number(k);
    const sn = Number(semilla);
    if (!Number.isInteger(kn) || kn < 2 || kn > 10) return setError('k (número de grupos) debe ser un entero de 2 a 10. Con 3 zonas con datos solo se puede k = 2.');
    if (!Number.isInteger(sn) || sn < 0) return setError('La semilla debe ser un entero mayor o igual a 0.');
    if (indicadores.length < 1) return setError('Elige al menos un indicador para agrupar.');
    if (desde && hasta && desde > hasta) return setError('La fecha «desde» no puede ser posterior a «hasta».');
    setCorriendo(true);
    try {
      const nueva = await correrClustering({
        k: kn,
        seed: sn,
        features: indicadores,
        ...(desde ? { dateFrom: desde } : {}),
        ...(hasta ? { dateTo: hasta } : {}),
      });
      setCorrida(nueva);
      setEjeX('');
      setEjeY('');
      historial.refetch();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo correr la agrupación. Intenta de nuevo.'));
    } finally {
      setCorriendo(false);
    }
  }

  async function abrir(id: string) {
    setError(null);
    setAbriendo(id);
    try {
      setCorrida(await getCorridaClustering(id));
      setEjeX('');
      setEjeY('');
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo abrir la corrida.'));
      historial.refetch(); // si ya no existe (404) desaparece de la lista
    } finally {
      setAbriendo(null);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Agrupación de zonas"
        description="Agrupa zonas con indicadores parecidos (ingreso, población, disponibilidad y ticket). Propone grupos: no cambia la clasificación de ninguna zona."
      />

      {!puedeCorrer && <p className="mx-6 rounded-full bg-arena px-5 py-3 text-sm text-teal">Solo el Analista comercial corre agrupaciones; aquí puedes consultar las ya guardadas.</p>}

      {puedeCorrer && (
        <form noValidate onSubmit={correr} className="mx-6 flex flex-col gap-4 rounded-panel bg-arena p-6">
          <div className="flex flex-wrap items-end gap-3.5">
            <label className={labelClass}>
              Número de grupos (k)
              <input type="number" min="2" max="10" className={`${inputClass} w-36`} value={k} onChange={(e) => setK(e.target.value)} />
            </label>
            <label className={labelClass}>
              Semilla
              <input type="number" min="0" className={`${inputClass} w-36`} value={semilla} onChange={(e) => setSemilla(e.target.value)} />
            </label>
            <label className={labelClass}>
              Ticket desde
              <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label className={labelClass}>
              Ticket hasta
              <input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-semibold text-teal">Indicadores con los que se agrupa</legend>
            <div className="flex flex-wrap gap-2">
              {TODOS.map((i) => (
                <label key={i} className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm transition ${indicadores.includes(i) ? 'bg-vino text-arena' : 'bg-marfil text-tinta hover:bg-salvia/30'}`}>
                  <input type="checkbox" className="sr-only" checked={indicadores.includes(i)} onChange={() => alternar(i)} />
                  {INDICADORES[i].nombre}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-teal/70">Límite del Parcial 2: k debe ser menor al número de zonas con datos; con las 3 zonas de los datos de prueba solo se puede k = 2.</p>
          <div className="flex items-center justify-between gap-4">
            <span className="min-w-0 flex-1">{error && <ErrorText>{error}</ErrorText>}</span>
            <button type="submit" disabled={corriendo} className="flex h-[52px] shrink-0 items-center rounded-full bg-teal px-6 text-[15px] font-bold text-arena transition hover:bg-vino disabled:opacity-50">
              {corriendo ? 'Agrupando…' : 'Agrupar zonas'}
            </button>
          </div>
        </form>
      )}
      {!puedeCorrer && error && <div className="mx-6"><ErrorText>{error}</ErrorText></div>}

      {corrida && (
        <DetalleCorrida
          corrida={corrida}
          tipo={tipo}
          onTipo={setTipo}
          ejeX={ejeX}
          ejeY={ejeY}
          onEjes={(x, y) => { setEjeX(x); setEjeY(y); }}
        />
      )}

      <div className="mx-6 flex flex-col gap-3">
        <h2 className="font-display text-2xl text-vino">Corridas guardadas</h2>
        {historial.loading && !historial.data && <Cargando etiqueta="Cargando corridas…" />}
        {historial.error && <EstadoError mensaje={historial.error} onReintentar={historial.reintentable ? historial.refetch : undefined} />}
        {historial.data && filas.length === 0 && <p className="text-sm text-teal/70">Todavía no hay agrupaciones guardadas.</p>}
        {filas.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => abrir(c.id)}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[28px] bg-arena px-5 py-3 text-left text-sm transition hover:bg-salvia/30"
          >
            <span className="font-semibold text-tinta">
              k = {c.parameters?.k ?? '—'} · {c.zoneCount ?? '—'} zonas · {(c.parameters?.features ?? []).length} indicadores
            </span>
            <span className="font-data text-xs text-teal/80">
              {abriendo === c.id ? 'Abriendo…' : fechaHora(c.date)} · usuario {String(c.userId).slice(0, 8)}…
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function DetalleCorrida({
  corrida,
  tipo,
  onTipo,
  ejeX,
  ejeY,
  onEjes,
}: {
  corrida: CorridaClustering;
  tipo: 'dispersion' | 'perfil' | 'tamano';
  onTipo: (t: 'dispersion' | 'perfil' | 'tamano') => void;
  ejeX: IndicadorZona | '';
  ejeY: IndicadorZona | '';
  onEjes: (x: IndicadorZona | '', y: IndicadorZona | '') => void;
}) {
  const features = corrida.parameters?.features ?? [];
  const x = (ejeX || features[0]) as IndicadorZona | undefined;
  const y = (ejeY || features[1] || features[0]) as IndicadorZona | undefined;
  const clusters = listaSegura<NonNullable<CorridaClustering['clusters']>[number]>(corrida.clusters);
  const asignaciones = listaSegura<NonNullable<CorridaClustering['assignments']>[number]>(corrida.assignments);
  const excluidas = listaSegura<NonNullable<CorridaClustering['excludedZones']>[number]>(corrida.excludedZones);
  const puedeDispersion = features.length >= 2;
  const tipoEfectivo = tipo === 'dispersion' && !puedeDispersion ? 'perfil' : tipo;

  return (
    <div className="mx-6 flex flex-col gap-4 rounded-panel bg-arena p-6" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full bg-vino px-4 py-1.5 font-bold text-arena">{clusters.length} grupos</span>
        <span className="font-data text-teal">k = {corrida.parameters?.k} · semilla {corrida.parameters?.seed} · {fechaHora(corrida.date)}</span>
        {typeof corrida.silhouette === 'number' && (
          <span className="font-data text-teal" title="De −1 a 1: qué tan separados quedaron los grupos (más cerca de 1, mejor)">
            silueta {corrida.silhouette.toFixed(2)}
          </span>
        )}
        {typeof corrida.inertia === 'number' && <span className="font-data text-teal" title="Suma de distancias al centro de cada grupo (menor = grupos más compactos)">inercia {corrida.inertia.toFixed(2)}</span>}
      </div>

      <div className="rounded-[28px] bg-marfil p-4">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          {tipoEfectivo === 'dispersion' && x && y ? (
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-teal">
                Eje horizontal
                <select className="h-10 rounded-full bg-arena px-3 text-sm" value={x} onChange={(e) => onEjes(e.target.value as IndicadorZona, y)}>
                  {features.map((f) => <option key={f} value={f}>{INDICADORES[f].nombre}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-teal">
                Eje vertical
                <select className="h-10 rounded-full bg-arena px-3 text-sm" value={y} onChange={(e) => onEjes(x, e.target.value as IndicadorZona)}>
                  {features.map((f) => <option key={f} value={f}>{INDICADORES[f].nombre}</option>)}
                </select>
              </label>
            </div>
          ) : <span />}
          <SelectorTipoGrafica
            nombre="la agrupación"
            valor={tipoEfectivo}
            onChange={onTipo}
            opciones={[
              { clave: 'dispersion', etiqueta: 'Dispersión', ayuda: 'Cada zona es un punto, de color según su grupo; elige los ejes.', noDisponible: puedeDispersion ? undefined : 'Se necesitan al menos 2 indicadores' },
              { clave: 'perfil', etiqueta: 'Perfil de grupos', ayuda: 'Cómo es cada grupo en cada indicador, relativo al grupo más alto (100 %).' },
              { clave: 'tamano', etiqueta: 'Tamaño', ayuda: 'Cuántas zonas cayeron en cada grupo.' },
            ]}
          />
        </div>
        <Grafica key={`${tipoEfectivo}-${x}-${y}`} opciones={opcionesCorrida(corrida, tipoEfectivo, x, y)} altura={360} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-left text-sm">
          <thead>
            <tr className="text-[12px] font-semibold text-teal"><th className="px-3 py-1.5">Zona</th><th className="px-3 py-1.5">Grupo</th></tr>
          </thead>
          <tbody>
            {[...asignaciones].sort((a, b) => a.cluster - b.cluster).map((a) => (
              <tr key={a.zoneId} className="border-t border-salvia/25 text-tinta">
                <td className="px-3 py-1.5">{a.zoneName}</td>
                <td className="px-3 py-1.5 font-data">Grupo {a.cluster}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {clusters.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="text-[12px] font-semibold text-teal">
                <th className="px-3 py-1.5">Grupo</th><th className="px-3 py-1.5">Zonas</th>
                {features.map((f) => <th key={f} className="px-3 py-1.5">{INDICADORES[f].nombre} (promedio)</th>)}
              </tr>
            </thead>
            <tbody>
              {clusters.map((c) => (
                <tr key={c.cluster} className="border-t border-salvia/25 text-tinta">
                  <td className="px-3 py-1.5 font-data">Grupo {c.cluster}</td>
                  <td className="px-3 py-1.5 font-data">{c.size}</td>
                  {features.map((f) => <td key={f} className="px-3 py-1.5 font-data">{typeof c.centroid?.[f] === 'number' ? INDICADORES[f].formato(c.centroid[f] as number) : '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {excluidas.length > 0 && (
        <div className="rounded-[24px] bg-vino/10 px-4 py-3 text-sm text-vino" role="note">
          <p className="font-semibold">Zonas que no se pudieron agrupar (no se rellenan con 0):</p>
          <ul className="mt-1 list-disc pl-5">
            {excluidas.map((z) => <li key={z.zoneId}>{z.zoneName}: {z.reason}</li>)}
          </ul>
        </div>
      )}

      {(corrida.assumptions ?? []).length > 0 && (
        <details className="text-sm text-teal">
          <summary className="cursor-pointer font-semibold text-teal/70">Supuestos de la agrupación</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{(corrida.assumptions ?? []).map((a) => <li key={a}>{a}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function opcionesCorrida(c: CorridaClustering, tipo: 'dispersion' | 'perfil' | 'tamano', x?: IndicadorZona, y?: IndicadorZona): Highcharts.Options {
  const clusters = listaSegura<NonNullable<CorridaClustering['clusters']>[number]>(c.clusters);
  const features = c.parameters?.features ?? [];
  const color = (n: number) => COLORES_GRUPO[(n - 1) % COLORES_GRUPO.length];

  if (tipo === 'tamano') {
    return {
      chart: { type: 'pie' },
      tooltip: { pointFormat: '<b>{point.y}</b> zona(s)' },
      plotOptions: { pie: { innerSize: '58%', borderRadius: 6, dataLabels: { enabled: true, format: 'Grupo {point.name}: {point.y}', style: { textOutline: 'none', color: COLORES.teal } } } },
      series: [{ type: 'pie', name: 'Zonas', data: clusters.map((g) => ({ name: String(g.cluster), y: g.size, color: color(g.cluster) })) }],
    };
  }

  if (tipo === 'perfil') {
    // Cada indicador va en su unidad (pesos, habitantes, proporción): se compara contra el grupo más alto.
    const maximos = Object.fromEntries(features.map((f) => [f, Math.max(...clusters.map((g) => Math.abs(Number(g.centroid?.[f] ?? 0))), 1e-9)]));
    return {
      chart: { type: 'column' },
      xAxis: { categories: features.map((f) => INDICADORES[f].nombre) },
      yAxis: { min: 0, max: 100, title: { text: '% del grupo más alto' } },
      tooltip: {
        useHTML: true,
        formatter() {
          const f = features[this.index];
          const g = clusters.find((cl) => `Grupo ${cl.cluster}` === (this as unknown as { series: { name: string } }).series.name);
          const valor = g?.centroid?.[f];
          return `<b>Grupo ${g?.cluster}</b><br/>${INDICADORES[f].nombre}: ${typeof valor === 'number' ? INDICADORES[f].formato(valor) : '—'}`;
        },
      },
      series: clusters.map((g) => ({
        type: 'column' as const,
        name: `Grupo ${g.cluster}`,
        color: color(g.cluster),
        borderRadius: 6,
        data: features.map((f) => Math.round((Math.abs(Number(g.centroid?.[f] ?? 0)) / (maximos[f] as number)) * 1000) / 10),
      })),
    };
  }

  // Dispersión: una serie por grupo, un punto por zona.
  const entrada = listaSegura<NonNullable<CorridaClustering['input']>[number]>(c.input);
  const asignaciones = listaSegura<NonNullable<CorridaClustering['assignments']>[number]>(c.assignments);
  const grupoDe = new Map(asignaciones.map((a) => [a.zoneId, a.cluster]));
  const fx = x ?? features[0];
  const fy = y ?? features[1] ?? features[0];
  return {
    chart: { type: 'scatter', zooming: { type: 'xy' } },
    xAxis: { title: { text: INDICADORES[fx].nombre } },
    yAxis: { title: { text: INDICADORES[fy].nombre } },
    tooltip: {
      useHTML: true,
      formatter() {
        const p = this as unknown as { point: { name: string; x: number; y: number }; series: { name: string } };
        return `<b>${p.point.name}</b> · ${p.series.name}<br/>${INDICADORES[fx].nombre}: ${INDICADORES[fx].formato(p.point.x)}<br/>${INDICADORES[fy].nombre}: ${INDICADORES[fy].formato(p.point.y)}`;
      },
    },
    plotOptions: { scatter: { marker: { radius: 9, symbol: 'circle' }, dataLabels: { enabled: true, format: '{point.name}', style: { textOutline: 'none', fontSize: '11px', color: COLORES.teal } } } },
    series: clusters.map((g) => ({
      type: 'scatter' as const,
      name: `Grupo ${g.cluster}`,
      color: color(g.cluster),
      data: entrada
        .filter((z) => grupoDe.get(z.zoneId) === g.cluster && typeof z[fx] === 'number' && typeof z[fy] === 'number')
        .map((z) => ({ name: z.zoneName, x: z[fx] as number, y: z[fy] as number })),
    })),
  };
}
