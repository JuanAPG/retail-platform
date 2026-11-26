import { useFetch } from '../../hooks/useFetch';
import { ErrorText } from '../../components/ui/ErrorText';
import { DataTable, DataTableColumn } from '../../components/DataTable';
import { IconResultados } from '../../components/ui/icons';
import { ComparacionEscenarios, compararEscenarios, ResultadoEscenario } from '../../api/simulacion';
import { nombreIndicador, numero, variacion } from './simulacionFormato';

/** Una fila por indicador y zona; cada escenario aporta su valor simulado (o nada si no lo calculó). */
interface FilaComparacion {
  clave: string;
  indicatorKey: string;
  zoneId: string | null;
  porEscenario: Record<string, ResultadoEscenario | undefined>;
}

export function filasDeComparacion(datos: ComparacionEscenarios): FilaComparacion[] {
  const filas = new Map<string, FilaComparacion>();
  for (const esc of datos.scenarios) {
    for (const r of esc.results) {
      const clave = `${r.indicatorKey}|${r.zoneId ?? ''}`;
      const fila = filas.get(clave) ?? { clave, indicatorKey: r.indicatorKey, zoneId: r.zoneId, porEscenario: {} };
      fila.porEscenario[esc.scenarioId] = r;
      filas.set(clave, fila);
    }
  }
  return [...filas.values()];
}
import { EstadoError } from '../../components/EstadoError';

interface Props {
  seleccionados: string[];
  onElegirOtros: () => void;
}

/** M13 — Compara 2+ escenarios ya guardados, elegidos desde Historial. */
export function ResultadosSimulacionPanel({ seleccionados, onElegirOtros }: Props) {
  const comparacion = useFetch(
    () => (seleccionados.length >= 2 ? compararEscenarios(seleccionados) : Promise.resolve(null)),
    [seleccionados],
  );

  if (seleccionados.length < 2) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-4xl text-vino">Resultados</h1>
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
            <IconResultados className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">Sin escenarios para comparar todavía</p>
          <p className="max-w-md text-sm text-teal/70">Elige dos o más simulaciones guardadas en Historial para compararlas aquí lado a lado.</p>
        </div>
      </div>
    );
  }

  const datos = comparacion.data;
  const filas = datos ? filasDeComparacion(datos) : [];
  const columnas: DataTableColumn<FilaComparacion>[] = datos
    ? [
        { header: 'Indicador', render: (fila) => nombreIndicador(fila.indicatorKey) },
        ...datos.scenarios.map((esc) => ({
          header: esc.name,
          // Un escenario que no calculó ese indicador muestra "—", nunca 0.
          render: (fila: FilaComparacion) => {
            const r = fila.porEscenario[esc.scenarioId];
            return r ? `${numero(r.simulatedValue)} (${variacion(r.variationPct)})` : '—';
          },
        })),
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-4xl text-vino">Resultados</h1>
        <button
          type="button"
          onClick={onElegirOtros}
          className="flex h-10 items-center rounded-full border-2 border-salvia/60 px-4 text-xs font-bold text-teal transition hover:bg-salvia hover:text-tinta"
        >
          Elegir otros
        </button>
      </div>

      {comparacion.loading && <p className="text-sm text-teal/70">Cargando…</p>}
      {comparacion.error && <EstadoError mensaje={comparacion.error} onReintentar={comparacion.reintentable ? comparacion.refetch : undefined} />}

      {datos && datos.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-vino">
          {datos.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {datos && filas.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <p className="font-display text-xl text-teal">Estos escenarios no comparten ningún indicador</p>
        </div>
      )}

      {datos && filas.length > 0 && <DataTable rowKey={(fila) => fila.clave} rows={filas} columns={columnas} />}
    </div>
  );
}
