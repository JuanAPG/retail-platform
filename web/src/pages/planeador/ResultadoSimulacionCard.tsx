import { ResultadoSimulacion } from '../../api/simulacion';
import { nombreIndicador, numero, variacion } from './simulacionFormato';

/** Tarjeta compartida: el resultado recién calculado (Nueva simulación) y una fila de Historial se ven igual. */
export function ResultadoSimulacionCard({ resultado }: { resultado: ResultadoSimulacion }) {
  return (
    <div className="flex flex-col gap-3 rounded-panel bg-arena p-6">
      <h2 className="font-slab text-[22px] text-vino">Resultado</h2>
      {resultado.note && <p className="text-sm text-teal/70">{resultado.note}</p>}
      <div className="flex flex-col gap-2">
        {resultado.results.map((r) => (
          <div key={r.indicatorKey} className="flex items-center justify-between gap-3 rounded-full bg-marfil px-4 py-2.5">
            <span className="text-sm font-bold text-tinta">{nombreIndicador(r.indicatorKey)}</span>
            <span className="font-data text-xs text-teal">
              {numero(r.baseValue)} → {numero(r.simulatedValue)}
            </span>
            <span className={`font-data text-sm font-semibold ${r.variationPct !== null && r.variationPct < 0 ? 'text-vino' : 'text-teal'}`}>
              {variacion(r.variationPct)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
