import { DataTable } from '../../components/DataTable';
import { ElasticityResult } from '../../types';
import { formatearDia } from './corridaFormato';
import { AtipicaBadge, ClasificacionBadge, formatearE, formatearR2, GRANULARIDAD } from './elasticidadFormato';

/**
 * M11 — Resultado de una corrida de elasticidad: lo que sí se pudo
 * calcular, lo que no (con su motivo) y los supuestos. Con pocos datos,
 * la lista de insuficientes es la que explica el resultado.
 */
export function ResultadoElasticidad({ resultado }: { resultado: ElasticityResult }) {
  const { results, insufficient, assumptions } = resultado;

  return (
    <div className="mb-8">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Resultado de la corrida</h2>
      <p className="mb-3 text-sm text-slate-500">
        Observaciones {GRANULARIDAD[resultado.granularity]} · datos del {formatearDia(resultado.periodStart)} al{' '}
        {formatearDia(resultado.periodEnd)}
      </p>

      {results.length === 0 ? (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">
            Ninguna combinación tuvo datos suficientes. La corrida quedó guardada; abajo están los motivos.
          </p>
        </div>
      ) : (
        <DataTable
          rowKey={(r) => `${r.presentationId}-${r.zoneId ?? 'nacional'}`}
          rows={results}
          columns={[
            { header: 'Producto', render: (r) => r.productName },
            { header: 'Presentación', render: (r) => r.presentationName },
            { header: 'Zona', render: (r) => r.zoneName },
            {
              header: 'E',
              render: (r) => (
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="tabular-nums">{formatearE(r.value)}</span>
                  {r.atypical && <AtipicaBadge />}
                </span>
              ),
            },
            { header: 'Clasificación', render: (r) => <ClasificacionBadge clase={r.classification} /> },
            { header: 'R²', className: 'tabular-nums', render: (r) => formatearR2(r.rSquared) },
            { header: 'Obs.', className: 'tabular-nums', render: (r) => r.observations },
          ]}
        />
      )}

      {insufficient.length > 0 && (
        <details className="mt-4 text-sm text-slate-700" open={results.length === 0}>
          <summary className="cursor-pointer text-slate-500">Sin datos suficientes ({insufficient.length})</summary>
          <div className="mt-2">
            <DataTable
              rowKey={(r) => `${r.presentationId}-${r.zoneId ?? 'nacional'}`}
              rows={insufficient}
              columns={[
                { header: 'Producto', render: (r) => r.productName },
                { header: 'Presentación', render: (r) => r.presentationName },
                { header: 'Zona', render: (r) => r.zoneName },
                { header: 'Obs.', className: 'tabular-nums', render: (r) => r.observations },
                { header: 'Precios', className: 'tabular-nums', render: (r) => r.distinctPrices },
                { header: 'Motivo', render: (r) => r.reason },
              ]}
            />
          </div>
        </details>
      )}

      <details className="mt-3 text-sm text-slate-700">
        <summary className="cursor-pointer text-slate-500">Supuestos ({assumptions.length})</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
