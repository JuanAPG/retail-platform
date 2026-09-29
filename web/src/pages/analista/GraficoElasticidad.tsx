import { useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { EmptyState } from '../../components/EmptyState';
import { Select } from '../../components/ui/Select';
import { ErrorText } from '../../components/ui/ErrorText';
import { getGraficoElasticidad } from '../../api/elasticidad';
import { mensajeDeError } from '../../api/errores';
import { ElasticityChartBar, ElasticityChartData, ElasticityChartValue, Producto } from '../../types';
import { formatearDia, formatearFechaHora } from './corridaFormato';
import { AtipicaBadge, CLASIFICACION, ClasificacionBadge, formatearE, formatearR2, GRANULARIDAD } from './elasticidadFormato';

interface GraficoElasticidadProps {
  productos: Producto[];
  presentacionId: string;
  onPresentacion: (id: string) => void;
  /** Corrida recién calculada; null = la más reciente con resultados de la presentación. */
  runId: string | null;
}

/**
 * M11 — Gráfico comparativo de una presentación por zona o por segmento.
 * Barras propias (sin librería): el largo es |E| y la línea marca
 * |E| = 1, la frontera entre inelástica y elástica.
 */
export function GraficoElasticidad({ productos, presentacionId, onPresentacion, runId }: GraficoElasticidadProps) {
  const [agrupar, setAgrupar] = useState<'zone' | 'segment'>('zone');
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

          <div className="flex text-xs text-teal/60">
            <span className="w-36 shrink-0" />
            <span className="relative flex-1">
              <span className="absolute -translate-x-1/2" style={{ left: `${(1 / escala) * 100}%` }}>
                |E| = 1
              </span>
            </span>
            <span className="w-72 shrink-0" />
          </div>

          <ul className="flex flex-col gap-2.5">
            {datos.bars.map((b) => (
              <Fila key={b.key} etiqueta={b.label} valor={b} escala={escala} zonas={b.zones} />
            ))}
          </ul>
          {datos.national && (
            <ul className="flex flex-col gap-2.5 border-t-2 border-salvia/20 pt-3">
              <Fila etiqueta="Nacional" valor={datos.national} escala={escala} destacada />
            </ul>
          )}

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
