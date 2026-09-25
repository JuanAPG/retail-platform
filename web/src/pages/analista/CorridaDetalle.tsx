import { Badge } from '../../components/Badge';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { parametro } from '../../api/asociacion';
import { AnalysisRun, AnalysisRunFilter, AssociationRule, IncomeSegment, Tienda, Zona } from '../../types';
import { EstadoCorridaBadge, formatearDia, formatearFechaHora, porcentaje } from './corridaFormato';

interface CorridaDetalleProps {
  corrida: AnalysisRun | null;
  loading: boolean;
  error: string | null;
  onReintentar: () => void;
  tiendas: Tienda[];
  zonas: Zona[];
  segmentos: IncomeSegment[];
}

/**
 * M10 — Una corrida de Apriori: con qué datos, parámetros y supuestos se
 * obtuvo, y sus reglas. Es donde se ve la reproducibilidad que exige RF-15.
 */
export function CorridaDetalle({ corrida, loading, error, onReintentar, tiendas, zonas, segmentos }: CorridaDetalleProps) {
  if (loading) return <p className="text-sm text-slate-500">Cargando corrida…</p>;
  if (error) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={onReintentar}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Reintentar
        </button>
      </div>
    );
  }
  if (!corrida) {
    return (
      <EmptyState title="Ninguna corrida seleccionada" description="Selecciona una corrida del historial o corre una nueva." />
    );
  }

  /** La base guarda ids; se muestran con nombre cuando el catálogo lo tiene. */
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
    <div>
      <div className="mb-4 rounded border border-slate-200 px-4 py-3 text-sm text-slate-700">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <EstadoCorridaBadge estado={corrida.status} />
          <span className="text-slate-500">{formatearFechaHora(corrida.date)}</span>
          {corrida.user && <span className="text-slate-500">· por {corrida.user.nombre}</span>}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          <div>
            <dt className="inline text-slate-500">Periodo de los datos: </dt>
            <dd className="inline">
              {formatearDia(corrida.periodStart)} → {formatearDia(corrida.periodEnd)}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Canastas analizadas: </dt>
            <dd className="inline">{corrida.basketsConsidered ?? '—'}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Soporte / confianza mínimos: </dt>
            <dd className="inline">
              {porcentaje(parametro(corrida, 'soporte_minimo'))} / {porcentaje(parametro(corrida, 'confianza_minima'))}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Productos por regla (máx.): </dt>
            <dd className="inline">{parametro(corrida, 'tamano_maximo_itemset') ?? '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline text-slate-500">Filtros: </dt>
            <dd className="inline">{filtros.length === 0 ? 'ninguno (todas las canastas del periodo)' : filtros.map(nombreFiltro).join(' · ')}</dd>
          </div>
        </dl>
      </div>

      {corrida.status === 'fallida' ? (
        <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-medium text-rose-800">La corrida no se completó</p>
          <p className="mt-1 break-words text-sm text-rose-700">{corrida.errorMessage}</p>
        </div>
      ) : reglas.length === 0 ? (
        <EmptyState
          title="La corrida no generó reglas"
          description="Ninguna combinación superó el soporte y la confianza mínimos. Prueba bajando alguno de los dos."
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-500">
            {reglas.length} regla(s)
            {excluidas > 0 && `; ${excluidas} excluida(s) por combinar categorías vetadas (RN-10)`}.
          </p>
          <DataTable
            rowKey={(r) => r.id}
            rows={reglas}
            columns={[
              { header: 'Si compra', render: (r) => productos(r, 'antecedente') },
              { header: 'También compra', render: (r) => productos(r, 'consecuente') },
              { header: 'Soporte', className: 'tabular-nums', render: (r) => porcentaje(r.support) },
              { header: 'Confianza', className: 'tabular-nums', render: (r) => porcentaje(r.confidence) },
              { header: 'Lift', render: (r) => <Lift valor={r.lift} /> },
              { header: 'Canastas', className: 'tabular-nums', render: (r) => r.transactionCount ?? '—' },
            ]}
          />
        </>
      )}

      {corrida.assumptions && corrida.assumptions.length > 0 && (
        <details className="mt-4 text-sm text-slate-700">
          <summary className="cursor-pointer text-slate-500">Supuestos ({corrida.assumptions.length})</summary>
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

function productos(regla: AssociationRule, lado: 'antecedente' | 'consecuente'): string {
  return regla.items
    .filter((i) => i.side === lado)
    .map((i) => i.product.nombre)
    .join(' + ');
}

/** Lift con su lectura: es lo que vuelve interpretable la regla. */
function Lift({ valor }: { valor: number | null }) {
  if (valor === null) return <span>—</span>;
  const texto = valor.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lectura =
    valor > 1.1 ? (
      <Badge tone="positive">▲ Se compran juntos</Badge>
    ) : valor < 0.9 ? (
      <Badge tone="negative">▼ Se evitan</Badge>
    ) : (
      <Badge>Sin relación clara</Badge>
    );
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span className="tabular-nums">{texto}</span>
      {lectura}
    </span>
  );
}
