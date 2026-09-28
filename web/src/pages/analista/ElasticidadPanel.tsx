import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { useFetch } from '../../hooks/useFetch';
import { getProductos } from '../../api/catalogo';
import { calcularElasticidad } from '../../api/elasticidad';
import { mensajeDeError } from '../../api/errores';
import { ElasticityParams, ElasticityResult } from '../../types';
import { GraficoElasticidad } from './GraficoElasticidad';
import { ResultadoElasticidad } from './ResultadoElasticidad';

const inputCls = 'w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900';
const labelCls = 'mb-1 block text-xs font-medium text-slate-600';

/**
 * M11 — Elasticidad de precios: calcular (guarda una corrida), leer el
 * resultado con su contexto y comparar una presentación entre zonas o
 * segmentos.
 */
export function ElasticidadPanel() {
  const productos = useFetch(getProductos, []);
  const conPresentaciones = (productos.data ?? []).filter((p) => p.presentaciones?.length > 0);

  const [params, setParams] = useState<ElasticityParams>({ granularity: 'day' });
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ElasticityResult | null>(null);

  const [presentacionGrafico, setPresentacionGrafico] = useState('');
  const [runGrafico, setRunGrafico] = useState<string | null>(null);

  const fechasInvertidas = Boolean(params.dateFrom && params.dateTo && params.dateTo < params.dateFrom);

  async function calcular(e: React.FormEvent) {
    e.preventDefault();
    if (fechasInvertidas || calculando) return;
    setCalculando(true);
    setError(null);
    try {
      const r = await calcularElasticidad(params);
      setResultado(r);
      // El gráfico salta a la corrida recién calculada, con la presentación
      // pedida o, si fueron todas, la primera que tuvo resultado.
      setRunGrafico(r.runId);
      const elegida = params.presentationId || presentacionGrafico || r.results[0]?.presentationId || '';
      setPresentacionGrafico(elegida);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo calcular la elasticidad. Intenta de nuevo.'));
    } finally {
      setCalculando(false);
    }
  }

  return (
    <section>
      <SectionHeader
        title="Elasticidad de precios"
        description="Cuánto cambia la cantidad vendida cuando cambia el precio. Cada cálculo se guarda como corrida con sus parámetros y supuestos."
      />

      <form onSubmit={calcular} className="mb-6 rounded border border-slate-200 px-4 py-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Calcular</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelCls} htmlFor="ela-presentacion">Presentación</label>
            <select
              id="ela-presentacion"
              className={inputCls}
              value={params.presentationId ?? ''}
              onChange={(e) => setParams((p) => ({ ...p, presentationId: e.target.value || undefined }))}
            >
              <option value="">Todas con ventas</option>
              {conPresentaciones.map((p) => (
                <optgroup key={p.id} label={p.nombre}>
                  {p.presentaciones.map((pp) => (
                    <option key={pp.id} value={pp.id}>
                      {p.nombre} · {pp.nombre}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="ela-desde">Desde</label>
            <input
              id="ela-desde"
              type="date"
              className={inputCls}
              value={params.dateFrom ?? ''}
              onChange={(e) => setParams((p) => ({ ...p, dateFrom: e.target.value || undefined }))}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="ela-hasta">Hasta</label>
            <input
              id="ela-hasta"
              type="date"
              className={inputCls}
              value={params.dateTo ?? ''}
              onChange={(e) => setParams((p) => ({ ...p, dateTo: e.target.value || undefined }))}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="ela-granularidad">Observaciones</label>
            <select
              id="ela-granularidad"
              className={inputCls}
              value={params.granularity ?? 'day'}
              onChange={(e) => setParams((p) => ({ ...p, granularity: e.target.value as 'day' | 'week' }))}
            >
              <option value="day">Por día</option>
              <option value="week">Por semana</option>
            </select>
            <p className="mt-1 text-xs text-slate-400">Por día aprovecha mejor pocos datos; por semana, con más historia.</p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-xs text-red-600">
            {fechasInvertidas ? 'La fecha final no puede ser anterior a la inicial.' : error}
          </p>
          <button
            type="submit"
            disabled={fechasInvertidas || calculando}
            className="shrink-0 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {calculando ? 'Calculando…' : 'Calcular'}
          </button>
        </div>
      </form>

      {resultado && <ResultadoElasticidad resultado={resultado} />}

      <GraficoElasticidad
        productos={conPresentaciones}
        presentacionId={presentacionGrafico}
        onPresentacion={(id) => {
          // Al elegir otra presentación se grafica su corrida más reciente
          // con resultados: la recién calculada podría no incluirla.
          setPresentacionGrafico(id);
          setRunGrafico(null);
        }}
        runId={runGrafico}
      />

      <p className="text-xs text-slate-400">
        E = −1.5: si el precio sube 1 %, la cantidad vendida baja 1.5 %. Elástica (|E| &gt; 1): la demanda reacciona más
        que el precio, y subirlo reduce el ingreso. Inelástica (|E| &lt; 1): reacciona menos. Unitaria (|E| ≈ 1).
        Atípica (E &gt; 0): la demanda subió con el precio, casi siempre por pocos datos u otros factores. Es un
        indicador analítico: léelo junto con el R² y el número de observaciones.
      </p>
    </section>
  );
}
