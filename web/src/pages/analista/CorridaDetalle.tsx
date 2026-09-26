import { StatusPill } from '../../components/ui/StatusPill';
import { parametro } from '../../api/asociacion';
import { AnalysisRun, AnalysisRunFilter, AssociationRule, IncomeSegment, Tienda, Zona } from '../../types';
import { EstadoCorridaBadge, formatearDia, formatearFechaHora, porcentaje } from './corridaFormato';
import { IconAsociacion, IconFlecha } from '../../components/ui/icons';

interface CorridaDetalleProps {
  corrida: AnalysisRun | null;
  loading: boolean;
  error: string | null;
  onReintentar: () => void;
  tiendas: Tienda[];
  zonas: Zona[];
  segmentos: IncomeSegment[];
}

const PALETA = ['bg-teal text-arena', 'bg-salvia text-tinta', 'bg-tinta text-arena'];

/** M10 — Una corrida de Apriori: con qué datos, parámetros y supuestos se obtuvo, y sus reglas (RF-15). */
export function CorridaDetalle({ corrida, loading, error, onReintentar, tiendas, zonas, segmentos }: CorridaDetalleProps) {
  if (loading) return <p className="text-sm text-teal/70">Cargando corrida…</p>;
  if (error) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm font-semibold text-vino">{error}</p>
        <button type="button" onClick={onReintentar} className="flex h-9 items-center rounded-full border-2 border-salvia/60 px-4 text-xs font-bold text-teal hover:bg-salvia hover:text-tinta">
          Reintentar
        </button>
      </div>
    );
  }
  if (!corrida) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
        <p className="font-display text-xl text-teal">Ninguna corrida seleccionada</p>
        <p className="text-sm text-teal/70">Selecciona una del historial o corre una nueva.</p>
      </div>
    );
  }

  function nombreFiltro(f: AnalysisRunFilter): string {
    if (f.dimension === 'zona') return `Zona: ${zonas.find((z) => z.id === f.referenceId)?.nombre ?? f.referenceId}`;
    if (f.dimension === 'tienda') return `Tienda: ${tiendas.find((t) => t.id === f.referenceId)?.nombre ?? f.referenceId}`;
    if (f.dimension === 'segmento') {
      return `Segmento: ${segmentos.find((s) => String(s.id) === f.referenceId)?.name ?? f.referenceId}`;
    }
    return `${f.dimension}: ${f.referenceId}`;
  }

  const reglas = corrida.results ?? [];
  const excluidas = Number(parametro(corrida, 'reglas_excluidas_rn10') ?? 0);
  const filtros = corrida.filters ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-panel bg-arena p-5 text-sm text-teal">
        <div className="flex flex-wrap items-center gap-2">
          <EstadoCorridaBadge estado={corrida.status} />
          <span className="text-teal/70">{formatearFechaHora(corrida.date)}</span>
          {corrida.user && <span className="text-teal/70">· por {corrida.user.nombre}</span>}
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          <p>
            <span className="text-teal/70">Periodo: </span>
            {formatearDia(corrida.periodStart)} → {formatearDia(corrida.periodEnd)}
          </p>
          <p>
            <span className="text-teal/70">Canastas analizadas: </span>
            {corrida.basketsConsidered ?? '—'}
          </p>
          <p>
            <span className="text-teal/70">Soporte / confianza mín.: </span>
            {porcentaje(parametro(corrida, 'soporte_minimo'))} / {porcentaje(parametro(corrida, 'confianza_minima'))}
          </p>
          <p>
            <span className="text-teal/70">Productos por regla (máx.): </span>
            {parametro(corrida, 'tamano_maximo_itemset') ?? '—'}
          </p>
          <p className="sm:col-span-2">
            <span className="text-teal/70">Filtros: </span>
            {filtros.length === 0 ? 'ninguno (todas las canastas del periodo)' : filtros.map(nombreFiltro).join(' · ')}
          </p>
        </div>
      </div>

      {corrida.status === 'fallida' ? (
        <div className="rounded-panel border-2 border-dashed border-vino/40 px-5 py-4">
          <p className="text-sm font-semibold text-vino">La corrida no se completó</p>
          <p className="mt-1 break-words text-sm text-vino/80">{corrida.errorMessage}</p>
        </div>
      ) : reglas.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <p className="font-display text-xl text-teal">La corrida no generó reglas</p>
          <p className="max-w-sm text-sm text-teal/70">
            Ninguna combinación superó el soporte y la confianza mínimos. Prueba bajando alguno de los dos.
          </p>
        </div>
      ) : (
        <>
          <p className="px-1 text-sm text-teal/70">
            {reglas.length} regla(s)
            {excluidas > 0 && `; ${excluidas} excluida(s) por combinar categorías vetadas (RN-10)`}.
          </p>
          <div className="flex flex-col gap-2">
            {reglas.map((r) => (
              <ReglaCard key={r.id} regla={r} />
            ))}
          </div>
        </>
      )}

      {corrida.assumptions && corrida.assumptions.length > 0 && (
        <details className="rounded-panel bg-arena p-5 text-sm text-teal">
          <summary className="cursor-pointer font-semibold text-vino">Supuestos ({corrida.assumptions.length})</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {corrida.assumptions.map((a) => (
              <li key={a.order}>{a.assumption}</li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function ReglaCard({ regla }: { regla: AssociationRule }) {
  const antecedente = regla.items.filter((i) => i.side === 'antecedente');
  const consecuente = regla.items.filter((i) => i.side === 'consecuente');
  const lift = regla.lift;
  const lectura =
    lift === null ? null : lift > 1.1 ? (
      <StatusPill tone="ok" icon={<IconAsociacion className="h-3 w-3" />}>Se compran juntos</StatusPill>
    ) : lift < 0.9 ? (
      <StatusPill tone="warn">Se evitan</StatusPill>
    ) : (
      <StatusPill tone="neutral">Sin relación clara</StatusPill>
    );

  return (
    <div className="flex items-center gap-3.5 rounded-full border-2 border-transparent bg-marfil p-2 pr-4 transition hover:border-vino hover:translate-x-1">
      <span className="flex -space-x-2.5">
        {antecedente.map((item, i) => (
          <span
            key={item.productId}
            title={item.product.nombre}
            className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-marfil text-[11px] font-bold ${PALETA[i % PALETA.length]}`}
          >
            {item.product.nombre.slice(0, 2).toUpperCase()}
          </span>
        ))}
      </span>
      <IconFlecha className="h-[18px] w-[18px] flex-shrink-0 text-teal" />
      <span className="flex -space-x-2.5">
        {consecuente.map((item) => (
          <span
            key={item.productId}
            title={item.product.nombre}
            className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-marfil bg-vino text-[11px] font-bold text-arena"
          >
            {item.product.nombre.slice(0, 2).toUpperCase()}
          </span>
        ))}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold text-tinta">
          {antecedente.map((i) => i.product.nombre).join(' + ')} → {consecuente.map((i) => i.product.nombre).join(' + ')}
        </span>
        <span className="font-data text-xs text-teal">
          sop {porcentaje(regla.support)} · conf {porcentaje(regla.confidence)}
          {regla.transactionCount !== null && ` · ${regla.transactionCount} canastas`}
        </span>
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1">
        <span className="font-display text-2xl text-vino">{lift === null ? '—' : lift.toFixed(2)}</span>
        {lectura}
      </div>
    </div>
  );
}
