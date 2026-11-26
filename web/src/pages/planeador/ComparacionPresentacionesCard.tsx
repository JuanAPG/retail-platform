import { ComparacionPresentaciones, PresentacionComparada } from '../../api/simulacion';
import { numero } from './simulacionFormato';

const ESTADO_PRECIO: Record<PresentacionComparada['priceStatus'], string> = {
  con_precio: 'Con precio',
  sin_precio_en_la_zona: 'Sin precio en la zona',
  sin_precio_vigente: 'Sin precio vigente',
};

const dinero = (v: number | null) => (v === null ? '—' : `$${numero(v)}`);
const pct = (v: number | null) => (v === null ? '—' : `${numero(v)} %`);

/**
 * M13 / D-14 — Resultado de comparar las presentaciones de un producto: desembolso,
 * precio por unidad base, demanda y efecto en accesibilidad. Un dato sin precio sale
 * "—" y con su estado; nunca como 0.
 */
export function ComparacionPresentacionesCard({ resultado }: { resultado: ComparacionPresentaciones }) {
  return (
    <div className="flex flex-col gap-4 rounded-panel bg-arena p-6" data-testid="comparacion-presentaciones">
      <h2 className="font-slab text-[22px] text-vino">Presentaciones de {resultado.productName}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="text-[13px] font-semibold text-teal">
              <th className="px-3 py-2">Presentación</th>
              <th className="px-3 py-2">Precio</th>
              <th className="px-3 py-2 text-right">Desembolso</th>
              <th className="px-3 py-2 text-right">Precio por unidad</th>
              <th className="px-3 py-2 text-right">Demanda</th>
              <th className="px-3 py-2 text-right">% del ingreso</th>
              <th className="px-3 py-2 text-right">Sobreprecio por unidad</th>
            </tr>
          </thead>
          <tbody>
            {resultado.presentations.map((p) => (
              <tr key={p.presentationId} className="border-t border-salvia/25 text-tinta">
                <td className="px-3 py-2 font-semibold">
                  {p.presentationName}
                  {p.presentationId === resultado.referencePresentationId && <span className="ml-2 text-xs text-teal/70">(referencia)</span>}
                </td>
                <td className="px-3 py-2 text-xs">{ESTADO_PRECIO[p.priceStatus]}</td>
                <td className="px-3 py-2 text-right font-data">{dinero(p.outlay)}</td>
                <td className="px-3 py-2 text-right font-data">{p.unitPrice === null ? '—' : `${dinero(p.unitPrice)} / ${p.baseUnit}`}</td>
                <td className="px-3 py-2 text-right font-data">{p.estimatedDemand === null ? '—' : numero(p.estimatedDemand)}</td>
                <td className="px-3 py-2 text-right font-data">{pct(p.accessibilityEffect?.incomeSharePct ?? null)}</td>
                <td className="px-3 py-2 text-right font-data">{pct(p.accessibilityEffect?.unitPricePremiumPct ?? null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {resultado.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-vino">
          {resultado.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {resultado.assumptions.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-teal/70">
          {resultado.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
