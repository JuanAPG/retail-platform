import { useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { EmptyState } from '../../components/EmptyState';
import { Grafica } from '../../components/Grafica';
import { SelectorTipoGrafica } from '../../components/SelectorTipoGrafica';
import { COLORES } from '../../components/coloresGrafica';
import type Highcharts from 'highcharts';
import { Select } from '../../components/ui/Select';
import { ErrorText } from '../../components/ui/ErrorText';
import { getGraficoElasticidad } from '../../api/elasticidad';
import { mensajeDeError } from '../../api/errores';
import { ElasticityChartBar, ElasticityChartData, ElasticityChartValue, Producto } from '../../types';
import { formatearDia, formatearFechaHora } from './corridaFormato';
import { AtipicaBadge, CLASIFICACION, ClasificacionBadge, formatearE, formatearR2, GRANULARIDAD } from './elasticidadFormato';

const COLOR_CLASE = { elastic: COLORES.vino, inelastic: COLORES.salvia, unitary: COLORES.teal } as const;

export type TipoElasticidad = 'columnas' | 'barras' | 'telarana';

const TIPOS_ELASTICIDAD: { clave: TipoElasticidad; etiqueta: string; ayuda: string }[] = [
  { clave: 'columnas', etiqueta: 'Columnas', ayuda: '|E| por zona o segmento, en el orden de la lista.' },
  { clave: 'barras', etiqueta: 'Barras ordenadas', ayuda: 'De la más a la menos sensible al precio: la de arriba reacciona más.' },
  { clave: 'telarana', etiqueta: 'Telaraña', ayuda: 'El perfil de sensibilidad de todas las zonas de un vistazo; el anillo marca |E| = 1.' },
];

/**
 * |E| por zona/segmento (y Nacional) en tres formas: columnas, barras ordenadas y telaraña. En todas, la
 * referencia |E| = 1 marca la frontera entre inelástica y elástica. Una barra sin dato suficiente queda
 * vacía y lo dice el tooltip.
 */
function opcionesGrafica(datos: ElasticityChartData, tipo: TipoElasticidad): Highcharts.Options {
  const base: Array<{ nombre: string; v: ElasticityChartValue | ElasticityChartBar }> = [
    ...datos.bars.map((b) => ({ nombre: b.label, v: b })),
    ...(datos.national ? [{ nombre: 'Nacional', v: datos.national }] : []),
  ];
  const magnitud = (v: ElasticityChartValue | ElasticityChartBar) => (v.value === null ? -1 : Math.abs(v.value));
  const filas = tipo === 'barras' ? [...base].sort((x, y) => magnitud(y.v) - magnitud(x.v)) : base;
  const puntos = filas.map((f) => ({
    y: f.v.value === null ? null : Math.abs(f.v.value),
    color: f.v.classification ? COLOR_CLASE[f.v.classification] : COLORES.salvia,
  }));
  const tooltip: Highcharts.TooltipOptions = {
    useHTML: true,
    formatter() {
      const f = filas[this.index];
      if (!f || f.v.value === null || f.v.classification === null) return `<b>${f?.nombre ?? ''}</b><br/>Sin datos suficientes`;
      return `<b>${f.nombre}</b><br/>E = ${formatearE(f.v.value)} (${CLASIFICACION[f.v.classification].texto})<br/>R² ${formatearR2(f.v.rSquared)} · ${f.v.observations} obs.`;
    },
  };
  const unitaria = (extra: Highcharts.YAxisPlotLinesOptions = {}): Highcharts.YAxisPlotLinesOptions => ({
    value: 1, width: 2, color: COLORES.vino, dashStyle: 'Dash', zIndex: 5,
    label: { text: '|E| = 1', style: { color: COLORES.vino, fontWeight: '600' } }, ...extra,
  });

  if (tipo === 'telarana') {
    return {
      chart: { polar: true, type: 'line' },
      xAxis: { categories: filas.map((f) => f.nombre), tickmarkPlacement: 'on', lineWidth: 0 },
      yAxis: { min: 0, gridLineInterpolation: 'polygon', lineWidth: 0, title: { text: undefined }, plotLines: [unitaria({ label: undefined })] },
      legend: { enabled: false },
      tooltip,
      series: [{ type: 'area', name: '|E|', data: puntos.map((p) => p.y), color: COLORES.vino, fillOpacity: 0.18, marker: { enabled: true } }],
    };
  }

  const horizontal = tipo === 'barras';
  return {
    chart: { type: horizontal ? 'bar' : 'column' },
    xAxis: { categories: filas.map((f) => f.nombre) },
    yAxis: { min: 0, title: { text: '|E|' }, plotLines: [unitaria()] },
    legend: { enabled: false },
    tooltip,
    series: [
      {
        type: horizontal ? 'bar' : 'column',
        name: 'Elasticidad',
        data: puntos,
        borderRadius: 6,
        dataLabels: { enabled: true, format: '{y:.2f}' },
      },
    ],
  };
}

interface GraficoElasticidadProps {
  productos: Producto[];
  presentacionId: string;
  onPresentacion: (id: string) => void;
  /** Corrida recién calculada; null = la más reciente con resultados de la presentación. */
  runId: string | null;
}

/**
 * M11 — Gráfico comparativo de una presentación por zona o por segmento.
 * Columnas de Highcharts: la altura es |E| y la línea marca |E| = 1,
 * la frontera entre inelástica y elástica.
 */
export function GraficoElasticidad({ productos, presentacionId, onPresentacion, runId }: GraficoElasticidadProps) {
  const [agrupar, setAgrupar] = useState<'zone' | 'segment'>('zone');
  const [tipoGrafica, setTipoGrafica] = useState<TipoElasticidad>('columnas');
  const [datos, setDatos] = useState<ElasticityChartData | null>(null);
  const [cargando, setCargando] = useState(false);
  const [sinResultados, setSinResultados] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  // Carga propia y no useFetch: hay que distinguir el 404 ("nunca tuvo
  // resultados", un aviso) de un error real (con Reintentar).
  useEffect(() => {
    if (!presentacionId) {
      setDatos(null);
      return;
    }
    let cancelado = false;
    setCargando(true);
    setError(null);
    setSinResultados(null);
    getGraficoElasticidad({ presentationId: presentacionId, groupBy: agrupar, runId: runId ?? undefined })
      .then((d) => {
        if (!cancelado) setDatos(d);
      })
      .catch((err) => {
        if (cancelado) return;
        setDatos(null);
        if ((err as AxiosError).response?.status === 404) setSinResultados(mensajeDeError(err));
        else setError(mensajeDeError(err, 'No se pudo cargar el gráfico.'));
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [presentacionId, agrupar, runId, intento]);

  const valores = datos ? [...datos.bars.map((b) => b.value), datos.national?.value ?? null] : [];
  // Escala común: al menos un poco más que 1 para que la línea |E| = 1 siempre se vea.
  // La telaraña compara el perfil de varias zonas: con menos de 3 con dato no dice nada, así que se deshabilita.
  const conDato = datos ? [...datos.bars, ...(datos.national ? [datos.national] : [])].filter((b) => b.value !== null).length : 0;
  const tiposDisponibles: { clave: TipoElasticidad; etiqueta: string; ayuda: string; noDisponible?: string }[] = TIPOS_ELASTICIDAD.map((t) =>
    t.clave === 'telarana' && conDato < 3 ? { ...t, noDisponible: 'Se necesitan al menos 3 zonas o segmentos con dato' } : t,
  );
  const tipoEfectivo: TipoElasticidad = tiposDisponibles.find((t) => t.clave === tipoGrafica)?.noDisponible ? 'columnas' : tipoGrafica;
  const escala = Math.max(1.2, ...valores.filter((v): v is number => v !== null).map(Math.abs));

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-slab text-[22px] text-vino">Gráfico comparativo</h2>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Select id="gra-presentacion" label="Presentación" value={presentacionId} onChange={(e) => onPresentacion(e.target.value)} placeholder="Elige una presentación">
            {productos.flatMap((p) =>
              p.presentaciones.map((pp) => (
                <option key={pp.id} value={pp.id}>
                  {p.nombre} · {pp.nombre}
                </option>
              )),
            )}
          </Select>
        </div>
        <div className="flex gap-1 rounded-full bg-arena p-1.5" role="group" aria-label="Agrupar por">
          {(['zone', 'segment'] as const).map((opcion) => (
            <button
              key={opcion}
              type="button"
              onClick={() => setAgrupar(opcion)}
              className={`flex h-11 items-center rounded-full px-4 text-sm font-bold transition ${
                agrupar === opcion ? 'bg-vino text-arena' : 'text-teal hover:bg-salvia/25'
              }`}
            >
              {opcion === 'zone' ? 'Por zona' : 'Por segmento'}
            </button>
          ))}
        </div>
      </div>

      {!presentacionId && (
        <EmptyState title="Elige una presentación" description="El gráfico compara su elasticidad entre zonas o segmentos." />
      )}
      {cargando && <p className="text-sm text-teal/70">Cargando gráfico…</p>}
      {!cargando && sinResultados && <EmptyState title="Sin elasticidades para esta presentación" description={sinResultados} />}
      {!cargando && error && (
        <div className="flex items-center gap-3">
          <ErrorText>{error}</ErrorText>
          <button
            type="button"
            onClick={() => setIntento((n) => n + 1)}
            className="flex h-11 shrink-0 items-center rounded-full border-2 border-salvia/60 px-4 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta"
          >
            Reintentar
          </button>
        </div>
      )}

      {!cargando && datos && (
        <div className="flex flex-col gap-4 rounded-panel bg-arena p-6">
          <p className="text-sm text-teal/70">
            {datos.productName} {datos.presentationName} · análisis del {formatearFechaHora(datos.executedAt)} · observaciones{' '}
            {GRANULARIDAD[datos.granularity]} · datos del {formatearDia(datos.periodStart)} al {formatearDia(datos.periodEnd)}
          </p>

          <div className="flex justify-end">
            <SelectorTipoGrafica opciones={tiposDisponibles} valor={tipoEfectivo} onChange={setTipoGrafica} nombre="elasticidad" />
          </div>
          <Grafica key={tipoEfectivo} opciones={opcionesGrafica(datos, tipoEfectivo)} altura={tipoEfectivo === 'telarana' ? 420 : undefined} />

          <details className="text-sm text-teal">
            <summary className="cursor-pointer font-semibold text-teal/70">Ver detalle (R², observaciones y zonas)</summary>
            <ul className="mt-3 flex flex-col gap-2.5">
              {datos.bars.map((b) => (
                <Fila key={b.key} etiqueta={b.label} valor={b} escala={escala} zonas={b.zones} />
              ))}
            </ul>
            {datos.national && (
              <ul className="mt-3 flex flex-col gap-2.5 border-t-2 border-salvia/20 pt-3">
                <Fila etiqueta="Nacional" valor={datos.national} escala={escala} destacada />
              </ul>
            )}
          </details>

          <p className="text-xs text-teal/70">{datos.note}</p>
        </div>
      )}
    </div>
  );
}

interface FilaProps {
  etiqueta: string;
  valor: ElasticityChartValue | ElasticityChartBar;
  escala: number;
  zonas?: string[];
  destacada?: boolean;
}

function Fila({ etiqueta, valor, escala, zonas, destacada }: FilaProps) {
  const lineaUnitaria = `${(1 / escala) * 100}%`;
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className={`w-36 shrink-0 truncate ${destacada ? 'font-bold text-tinta' : 'text-teal'}`}>{etiqueta}</span>
      <span className="relative h-6 flex-1 rounded-full bg-marfil">
        {valor.value === null || valor.classification === null ? (
          <span className="absolute inset-0 flex items-center rounded-full border-2 border-dashed border-salvia/50 px-2 text-xs text-teal/60">
            sin datos suficientes
          </span>
        ) : (
          <span
            className={`absolute inset-y-0 left-0 rounded-full ${CLASIFICACION[valor.classification].barra}`}
            style={{ width: `${(Math.abs(valor.value) / escala) * 100}%` }}
          />
        )}
        <span className="absolute inset-y-0 border-l border-dashed border-vino/60" style={{ left: lineaUnitaria }} />
      </span>
      <span className="flex w-72 shrink-0 flex-wrap items-center gap-2">
        {valor.value !== null && valor.classification !== null && (
          <>
            <span className="font-data tabular-nums font-semibold text-tinta">{formatearE(valor.value)}</span>
            <ClasificacionBadge clase={valor.classification} />
            {valor.value > 0 && <AtipicaBadge />}
            <span className="text-xs text-teal/70">
              {valor.rSquared !== null && `R² ${formatearR2(valor.rSquared)} · `}
              {valor.observations} obs.
            </span>
          </>
        )}
        {zonas && zonas.length > 0 && <span className="w-full text-xs text-teal/60">{zonas.join(', ')}</span>}
      </span>
    </li>
  );
}
