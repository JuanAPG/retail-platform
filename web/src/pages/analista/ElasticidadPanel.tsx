import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { Select } from '../../components/ui/Select';
import { Field } from '../../components/ui/Field';
import { ErrorText } from '../../components/ui/ErrorText';
import { useFetch } from '../../hooks/useFetch';
import { getProductos } from '../../api/catalogo';
import { calcularElasticidad } from '../../api/elasticidad';
import { mensajeDeError } from '../../api/errores';
import { ElasticityParams, ElasticityResult } from '../../types';
import { GraficoElasticidad } from './GraficoElasticidad';
import { ResultadoElasticidad } from './ResultadoElasticidad';

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
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Elasticidad de precios"
        description="Cuánto cambia la cantidad vendida cuando cambia el precio. Cada cálculo se guarda como un análisis, con sus parámetros y supuestos."
      />

      <form onSubmit={calcular} className="flex flex-col gap-4 rounded-panel bg-arena p-6">
        <h2 className="font-slab text-[22px] text-vino">Calcular</h2>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            id="ela-presentacion"
            label="Presentación"
            value={params.presentationId ?? ''}
            onChange={(e) => setParams((p) => ({ ...p, presentationId: e.target.value || undefined }))}
            placeholder="Todas con ventas"
          >
            {conPresentaciones.flatMap((p) =>
              p.presentaciones.map((pp) => (
                <option key={pp.id} value={pp.id}>
                  {p.nombre} · {pp.nombre}
                </option>
              )),
            )}
          </Select>
          <Field
            id="ela-desde"
            label="Desde"
            type="date"
            value={params.dateFrom ?? ''}
            onChange={(e) => setParams((p) => ({ ...p, dateFrom: e.target.value || undefined }))}
          />
          <Field
            id="ela-hasta"
            label="Hasta"
            type="date"
            value={params.dateTo ?? ''}
            onChange={(e) => setParams((p) => ({ ...p, dateTo: e.target.value || undefined }))}
          />
          <div className="flex flex-col gap-1.5">
            <Select
              id="ela-granularidad"
              label="Observaciones"
              value={params.granularity ?? 'day'}
              onChange={(e) => setParams((p) => ({ ...p, granularity: e.target.value as 'day' | 'week' }))}
            >
              <option value="day">Por día</option>
              <option value="week">Por semana</option>
            </Select>
            <span className="text-xs text-teal/70">Por día aprovecha mejor pocos datos; por semana, con más historia.</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-semibold text-vino">{fechasInvertidas ? 'La fecha final no puede ser anterior a la inicial.' : error}</p>
          <button
            type="submit"
            disabled={fechasInvertidas || calculando}
            className="flex h-[52px] shrink-0 items-center rounded-full bg-teal px-6 text-[15px] font-bold text-arena transition hover:bg-vino disabled:opacity-50"
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

      <p className="text-xs text-teal/70">
        E = −1.5: si el precio sube 1 %, la cantidad vendida baja 1.5 %. Elástica (|E| &gt; 1): la demanda reacciona más
        que el precio, y subirlo reduce el ingreso. Inelástica (|E| &lt; 1): reacciona menos. Unitaria (|E| ≈ 1).
        Atípica (E &gt; 0): la demanda subió con el precio, casi siempre por pocos datos u otros factores. Es un
        indicador analítico: léelo junto con el R² y el número de observaciones.
      </p>
    </section>
  );
}
