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
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-slab text-[22px] text-vino">Resultado del análisis</h2>
        <p className="text-sm text-teal/70">
          Observaciones {GRANULARIDAD[resultado.granularity]} · datos del {formatearDia(resultado.periodStart)} al{' '}
          {formatearDia(resultado.periodEnd)}
        </p>
      </div>

      {results.length === 0 ? (
        <div className="rounded-full bg-vino/10 px-5 py-3">
          <p className="text-sm font-semibold text-vino">
            Ninguna combinación tuvo datos suficientes. El análisis quedó guardado; abajo están los motivos.
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
                  <span className="font-data tabular-nums">{formatearE(r.value)}</span>
                  {r.atypical && <AtipicaBadge />}
                </span>
              ),
            },
            { header: 'Clasificación', render: (r) => <ClasificacionBadge clase={r.classification} /> },
            { header: 'R²', className: 'font-data tabular-nums', render: (r) => formatearR2(r.rSquared) },
            { header: 'Obs.', className: 'font-data tabular-nums', render: (r) => r.observations },
          ]}
        />
      )}

      {insufficient.length > 0 && (
        <details className="text-sm text-teal" open={results.length === 0}>
          <summary className="cursor-pointer font-semibold text-teal/70">Sin datos suficientes ({insufficient.length})</summary>
          <div className="mt-2">
            <DataTable
              rowKey={(r) => `${r.presentationId}-${r.zoneId ?? 'nacional'}`}
              rows={insufficient}
              columns={[
                { header: 'Producto', render: (r) => r.productName },
                { header: 'Presentación', render: (r) => r.presentationName },
                { header: 'Zona', render: (r) => r.zoneName },
                { header: 'Obs.', className: 'font-data tabular-nums', render: (r) => r.observations },
                { header: 'Precios', className: 'font-data tabular-nums', render: (r) => r.distinctPrices },
                { header: 'Motivo', render: (r) => r.reason },
              ]}
            />
          </div>
        </details>
      )}

      <details className="text-sm text-teal">
        <summary className="cursor-pointer font-semibold text-teal/70">Supuestos ({assumptions.length})</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
