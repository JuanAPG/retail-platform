import { useFetch } from '../../hooks/useFetch';
import { ErrorText } from '../../components/ui/ErrorText';
import { DataTable, DataTableColumn } from '../../components/DataTable';
import { IconResultados } from '../../components/ui/icons';
import { compararEscenarios, ComparacionEscenariosFila } from '../../api/simulacion';
import { nombreIndicador, numero } from './simulacionFormato';

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
  const columnas: DataTableColumn<ComparacionEscenariosFila>[] = datos
    ? [
        { header: 'Indicador', render: (fila) => nombreIndicador(fila.indicatorKey) },
        ...datos.scenarioIds.map((id) => ({
          header: datos.scenarioNames[id] ?? id,
          render: (fila: ComparacionEscenariosFila) => numero(fila.valuesByScenario[id] ?? 0),
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
      {comparacion.error && <ErrorText>{comparacion.error}</ErrorText>}

      {datos && datos.rows.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <p className="font-display text-xl text-teal">Estos escenarios no comparten ningún indicador</p>
        </div>
      )}

      {datos && datos.rows.length > 0 && <DataTable rowKey={(fila) => fila.indicatorKey + (fila.zoneId ?? '')} rows={datos.rows} columns={columnas} />}
    </div>
  );
}
